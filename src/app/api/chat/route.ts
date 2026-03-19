import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { registry } from "@/lib/providers";
import { isPathAllowed } from "@/lib/path-security";

// Allow long-running CLI invocations
export const maxDuration = 300;

const VALID_PERMISSION_MODES = ["default", "trust", "acceptEdits", "readOnly", "plan"] as const;

/** Maximum allowed request body size (1 MB) */
const MAX_CHAT_BODY_SIZE = 1 * 1024 * 1024;

/** Maximum message length (100K characters, ~25K tokens) */
const MAX_MESSAGE_LENGTH = 100_000;

export async function POST(req: NextRequest) {
  try {
    // Validate content-length before parsing
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_CHAT_BODY_SIZE) {
      return new Response(
        JSON.stringify({ error: "Request body too large (max 1 MB)" }),
        { status: 413, headers: { "Content-Type": "application/json" } }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "Request body must be a JSON object" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { message, sessionId, cwd, permissionMode, allowedTools, provider: providerName, model } = body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Message too long (${message.length} chars). Maximum is ${MAX_MESSAGE_LENGTH}.` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate cwd if provided
    if (cwd && typeof cwd === "string") {
      if (!existsSync(cwd)) {
        return new Response(
          JSON.stringify({ error: "Working directory does not exist" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      if (!isPathAllowed(cwd)) {
        return new Response(
          JSON.stringify({ error: "Working directory is not in an allowed root" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Validate permissionMode
    if (permissionMode && !VALID_PERMISSION_MODES.includes(permissionMode)) {
      return new Response(
        JSON.stringify({ error: "Invalid permission mode" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Resolve provider (default: claude)
    const provider = providerName
      ? registry.get(providerName)
      : registry.getDefault();

    if (!provider) {
      return new Response(
        JSON.stringify({ error: `Unknown provider: ${providerName}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify provider CLI is available
    if (!provider.isAvailable()) {
      return new Response(
        JSON.stringify({ error: `${provider.displayName} CLI is not installed or not found on your system. Please install it first.` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build command using provider
    const { binary, args, env, stdinPrompt } = provider.buildCommand(message.trim(), {
      sessionId,
      cwd,
      permissionMode,
      allowedTools,
      model: model || undefined,
    });

    if (process.env.NODE_ENV === "development") {
      console.log(`[Chat API] Provider: ${provider.displayName} | Spawning: ${binary} ${args.join(" ")}${stdinPrompt ? " (prompt via stdin)" : ""}`);
    }

    const child = spawn(binary, args, {
      cwd: cwd || undefined,
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      shell: process.platform === "win32", // Windows needs shell to resolve .cmd wrappers
      stdio: ["pipe", "pipe", "pipe"],
    });

    // If provider requests stdin-based prompt (Windows: avoids cmd.exe mangling CJK/pipes)
    if (stdinPrompt) {
      child.stdin.write(stdinPrompt, "utf-8");
    }
    child.stdin.end();

    // Kill child process if client disconnects — graceful then forced
    req.signal.addEventListener("abort", () => {
      child.kill("SIGTERM");
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already dead */ }
      }, 3000);
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        let buffer = "";
        let closed = false;
        let stderrBuffer = "";
        let hasOutput = false;

        const safeEnqueue = (data: string) => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(data)); } catch { /* already closed */ }
        };

        const safeClose = () => {
          if (closed) return;
          closed = true;
          safeEnqueue("data: [DONE]\n\n");
          try { controller.close(); } catch { /* already closed */ }
        };

        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // keep incomplete last line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Let the provider parse and normalize the event
            const event = provider.parseEvent(trimmed);
            if (event) {
              hasOutput = true;
              safeEnqueue(`data: ${JSON.stringify(event.raw)}\n\n`);
            }
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          const errText = chunk.toString("utf-8").trim();
          if (errText) {
            console.error(`[Chat API] ${provider.displayName} stderr:`, errText);
            stderrBuffer += (stderrBuffer ? "\n" : "") + errText;
          }
        });

        child.on("error", (err) => {
          console.error(`[Chat API] ${provider.displayName} spawn error:`, err);
          const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `${provider.displayName} CLI not found at "${binary}". Make sure it is installed.`
            : err.message;
          safeEnqueue(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
          safeClose();
        });

        child.on("close", (code) => {
          if (process.env.NODE_ENV === "development") {
            console.log(`[Chat API] ${provider.displayName} exited with code ${code}`);
          }
          // Flush remaining buffer
          if (buffer.trim()) {
            const event = provider.parseEvent(buffer.trim());
            if (event) {
              hasOutput = true;
              safeEnqueue(`data: ${JSON.stringify(event.raw)}\n\n`);
            }
          }
          // If CLI exited with error, always send error event
          if (code !== 0) {
            const errorMsg = stderrBuffer || `CLI exited with code ${code}`;
            safeEnqueue(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`);
          } else if (code === 0 && !hasOutput) {
            // CLI exited OK but produced no parseable output — likely a resume issue
            const hint = stderrBuffer ? stderrBuffer : "CLI produced no output. The session may not be resumable.";
            safeEnqueue(`data: ${JSON.stringify({ type: "error", error: hint })}\n\n`);
          }
          safeClose();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    console.error("Chat API error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
