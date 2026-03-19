import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const maxDuration = 120;

function findClaudeBinary(): string {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const localBin = join(homedir(), ".local", "bin", exe);
  if (existsSync(localBin)) return localBin;
  return "claude";
}

function findGitBash(env: Record<string, string | undefined>): string | undefined {
  const candidates = [
    env.EXEPATH ? `${env.EXEPATH}\\bash.exe` : "",
    "E:\\App_Code\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  skill: `You are a Claude Code skill generator. Given a natural language description, generate a SKILL.md file for ~/.claude/skills/<name>/SKILL.md.

Output ONLY the markdown content for the SKILL.md file. Do not wrap in code fences. Do not include explanations outside the file content.

The skill file should:
- Start with a clear title (# heading)
- Include a brief description
- Have an ## Instructions section with clear, actionable instructions
- Optionally include ## Examples if helpful
- Be concise but thorough enough for Claude to follow

Example structure:
# Skill Name

Brief description of the skill.

## Instructions

Step-by-step instructions for Claude to follow when this skill is invoked.

## Examples

Optional examples of usage.`,

  agent: `You are a Claude Code agent definition generator. Given a natural language description, generate an agent .md file for ~/.claude/agents/<name>.md.

Output ONLY the markdown content with YAML frontmatter. Do not wrap in code fences. Do not include explanations outside the file content.

The agent file must have YAML frontmatter with:
- name: kebab-case agent name
- description: one-line description
- model: recommended model (sonnet, opus, or haiku)

Followed by markdown instructions.

Example structure:
---
name: my-agent
description: What this agent specializes in
model: sonnet
---

# Instructions

Detailed instructions for this agent's behavior and responsibilities.

## Capabilities

What this agent can do.

## Guidelines

Rules and constraints for the agent.`,

  rule: `You are a Claude Code rule generator. Given a natural language description, generate a rule .md file for ~/.claude/rules/<group>/<name>.md.

Output ONLY the markdown content. Do not wrap in code fences. Do not include explanations outside the file content.

The rule file should:
- Start with a clear title (# heading)
- Contain clear, actionable rules that Claude will follow automatically
- Use bullet points or numbered lists for individual rules
- Be specific and unambiguous
- Group related rules under ## subheadings if needed

Example structure:
# Rule Category

## Key Rules

- Rule 1: Description
- Rule 2: Description

## Guidelines

Additional guidelines and constraints.`,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description, type } = body;

    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(
        JSON.stringify({ error: "Description is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!type || !SYSTEM_PROMPTS[type]) {
      return new Response(
        JSON.stringify({ error: "Type must be one of: skill, agent, rule" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = SYSTEM_PROMPTS[type];
    const fullMessage = `${systemPrompt}\n\n---\n\nUser request: ${description.trim()}`;

    const args = [
      "-p", fullMessage,
      "--output-format", "stream-json",
      "--verbose",
    ];

    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE")) {
        delete env[key];
      }
    }
    if (process.platform === "win32") {
      const bashPath = findGitBash(env);
      if (bashPath) env.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
    }

    const claudeBin = findClaudeBinary();
    if (process.env.NODE_ENV === "development") {
      console.log(`[Generate API] Spawning: ${claudeBin} for ${type} generation`);
    }

    const child = spawn(claudeBin, args, {
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();

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

        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          const errText = chunk.toString("utf-8").trim();
          if (errText) {
            console.error("Generate CLI stderr:", errText);
          }
        });

        child.on("error", (err) => {
          console.error("Generate CLI spawn error:", err);
          const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `Claude Code CLI not found at "${claudeBin}".`
            : err.message;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        });

        child.on("close", () => {
          if (buffer.trim()) {
            controller.enqueue(encoder.encode(`data: ${buffer.trim()}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("Generate API error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
