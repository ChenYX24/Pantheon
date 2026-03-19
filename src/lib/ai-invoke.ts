/**
 * Shared AI invocation utility for server-side API routes.
 *
 * Uses the provider registry (Claude Code / Codex / API) to call an LLM.
 * Default: Claude Code. Configurable via the provider parameter.
 *
 * This is a simplified "prompt in, text out" interface for cases where
 * full SSE streaming is not needed (e.g. strategy generation, summaries).
 */

import { spawn } from "child_process";
import { registry } from "@/lib/providers";

export interface AiInvokeOptions {
  /** Provider name: "claude" | "codex". Default: "claude" */
  provider?: string;
  /** Model override (e.g. "claude-haiku-4-5-20251001" for cheaper calls) */
  model?: string;
  /** Timeout in ms. Default: 60000 (60s) */
  timeoutMs?: number;
}

/**
 * Send a prompt to the AI provider and return the full text response.
 *
 * Uses the same provider system as /api/chat (Claude Code CLI / Codex CLI).
 * On failure or timeout, returns null (caller should handle fallback).
 */
export async function aiInvoke(
  prompt: string,
  options: AiInvokeOptions = {},
): Promise<string | null> {
  const { provider: providerName = "claude", model, timeoutMs = 60000 } = options;

  const provider = registry.get(providerName) ?? registry.getDefault();
  if (!provider || !provider.isAvailable()) {
    console.error(`[aiInvoke] Provider "${providerName}" not available`);
    return null;
  }

  const { binary, args, env, stdinPrompt } = provider.buildCommand(prompt, {
    model,
    permissionMode: "readOnly", // AI invoke should never modify files
  });

  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      shell: process.platform === "win32",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: env as NodeJS.ProcessEnv,
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (result: string | null) => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    // Write prompt via stdin if provider requests it (Windows CJK safety)
    if (stdinPrompt) {
      child.stdin.write(stdinPrompt, "utf-8");
    }
    child.stdin.end();

    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        // Parse stream-json output to extract the final text
        const text = extractTextFromStreamJson(stdout, provider.parseEvent.bind(provider));
        finish(text || stdout.trim());
      } else {
        console.error(`[aiInvoke] Provider "${providerName}" exited with code ${code}`, stderr.slice(0, 200));
        finish(null);
      }
    });

    child.on("error", (err) => {
      console.error(`[aiInvoke] Spawn error:`, err);
      finish(null);
    });

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        console.error(`[aiInvoke] Timeout after ${timeoutMs}ms`);
        finish(null);
      }
    }, timeoutMs);
  });
}

/**
 * Extract the full assistant text from stream-json output.
 * The Claude CLI outputs one JSON per line; we accumulate "assistant" chunks
 * and prefer "result" if present.
 */
function extractTextFromStreamJson(
  raw: string,
  parseEvent: (line: string) => { type: string; raw: Record<string, unknown> } | null,
): string | null {
  let assistantText = "";
  let resultText: string | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const event = parseEvent(trimmed);
    if (!event) continue;

    if (event.type === "assistant" && typeof event.raw.content === "string") {
      assistantText += event.raw.content;
    }
    if (event.type === "result" && typeof event.raw.result === "string") {
      resultText = event.raw.result;
    }
  }

  return resultText ?? (assistantText || null);
}
