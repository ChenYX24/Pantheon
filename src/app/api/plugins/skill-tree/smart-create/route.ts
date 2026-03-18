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

function buildPrompt(description: string, existingSkills: string[]): string {
  return `You are a Skill Tree planner for an AI coding assistant platform called Super Claude Code (SCC).

The user wants to add a new capability described as: "${description}"

The system already has these skills installed:
${existingSkills.map((s) => `- ${s}`).join("\n")}

Your job:
1. Analyze what sub-capabilities are needed for "${description}"
2. Check which existing skills already satisfy those needs (list them as dependencies)
3. For any capability NOT covered by existing skills, create a new skill definition
4. Wire up the dependency graph correctly

Respond with ONLY a valid JSON object (no markdown fences, no explanation) in this exact format:
{
  "mainSkill": {
    "name": "English name",
    "nameZh": "中文名称",
    "description": "What this skill does in English",
    "descriptionZh": "中文描述",
    "category": "one of: foundation|coding|research|management|creative|integration|advanced|other",
    "tier": 2,
    "implType": "one of: cli|skill|mcp|plugin|api|manual|planned",
    "tags": ["tag1", "tag2"],
    "icon": "Lucide icon name",
    "dependencies": ["existing-skill-id-1"],
    "setupSteps": ["Step 1 in English", "Step 2"],
    "setupStepsZh": ["步骤1 中文", "步骤2"]
  },
  "newDependencies": [
    {
      "name": "Sub Skill Name",
      "nameZh": "子技能中文名",
      "description": "English description",
      "descriptionZh": "中文描述",
      "category": "category",
      "tier": 1,
      "implType": "implType",
      "tags": ["tag"],
      "icon": "Lucide icon name"
    }
  ],
  "existingDependencies": ["existing-skill-id-that-already-covers-a-need"],
  "reasoning": "Brief explanation in both English and Chinese of why these skills are needed / 简要说明为什么需要这些技能"
}

Rules:
- Keep skill names concise (2-4 words)
- Chinese names should be natural, not literal translations
- Categories must match the enum exactly
- implType "skill" means a Claude Code SKILL.md, "mcp" means MCP server, "api" means external API
- For stock/finance skills, use "api" implType. For search, use "mcp" or "skill"
- Tags should be lowercase English
- Only reference existing skill IDs from the list above
- Create the minimum number of new skills needed — reuse existing ones
- The reasoning field should explain the dependency chain naturally in both languages`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description, existingSkills } = body;

    if (!description || typeof description !== "string" || !description.trim()) {
      return new Response(
        JSON.stringify({ error: "Description is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const skillList: string[] = Array.isArray(existingSkills) ? existingSkills : [];
    const prompt = buildPrompt(description.trim(), skillList);

    const args = [
      "-p", prompt,
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
        let closed = false;

        function safeEnqueue(data: Uint8Array) {
          if (!closed) {
            try { controller.enqueue(data); } catch { /* ignore */ }
          }
        }
        function safeClose() {
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* ignore */ }
          }
        }

        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            safeEnqueue(encoder.encode(`data: ${trimmed}\n\n`));
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          const errText = chunk.toString("utf-8").trim();
          if (errText) console.error("Smart-create stderr:", errText);
        });

        child.on("error", (err) => {
          console.error("Smart-create spawn error:", err);
          const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `Claude CLI not found at "${claudeBin}".`
            : err.message;
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`));
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          safeClose();
        });

        child.on("close", () => {
          if (buffer.trim()) {
            safeEnqueue(encoder.encode(`data: ${buffer.trim()}\n\n`));
          }
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          safeClose();
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
    console.error("Smart-create API error:", err);
    const msg = err instanceof Error ? err.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
