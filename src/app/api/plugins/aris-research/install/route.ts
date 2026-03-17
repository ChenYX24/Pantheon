import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execAsync = promisify(exec);
const SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");
const ARIS_REPO = "https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep.git";

export async function GET() {
  // Check which ARIS skills are already installed
  const arisSkills = [
    "research-pipeline", "idea-discovery", "auto-review-loop", "paper-writing",
    "research-lit", "idea-creator", "novelty-check", "research-review",
    "research-refine", "research-refine-pipeline", "analyze-results",
    "run-experiment", "monitor-experiment", "experiment-plan",
    "paper-plan", "paper-figure", "paper-write", "paper-compile",
    "auto-paper-improvement-loop", "proof-writer", "feishu-notify",
    "auto-review-loop-llm", "auto-review-loop-minimax", "dse-loop",
  ];

  const installed: string[] = [];
  const missing: string[] = [];

  for (const skill of arisSkills) {
    const skillPath = path.join(SKILLS_DIR, skill);
    if (fs.existsSync(skillPath)) {
      installed.push(skill);
    } else {
      missing.push(skill);
    }
  }

  // Check MCP servers
  const mcpServersDir = path.join(os.homedir(), ".claude", "mcp-servers");
  const llmChatInstalled = fs.existsSync(path.join(mcpServersDir, "llm-chat", "server.py"));
  const minimaxInstalled = fs.existsSync(path.join(mcpServersDir, "minimax-chat", "server.py"));

  return NextResponse.json({
    installed,
    missing,
    total: arisSkills.length,
    mcpServers: { llmChat: llmChatInstalled, minimax: minimaxInstalled },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body.action || "install-skills";

  const tmpDir = path.join(os.tmpdir(), "aris-install");

  try {
    if (action === "install-skills") {
      // Clone repo to temp dir
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
      await execAsync(`git clone --depth 1 ${ARIS_REPO} "${tmpDir}"`, { timeout: 60000 });

      // Copy skills
      const skillsSrc = path.join(tmpDir, "skills");
      if (!fs.existsSync(skillsSrc)) {
        return NextResponse.json({ error: "Skills directory not found in repo" }, { status: 500 });
      }

      let copied = 0;
      const entries = fs.readdirSync(skillsSrc);
      for (const entry of entries) {
        const src = path.join(skillsSrc, entry);
        const dest = path.join(SKILLS_DIR, entry);
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dest, { recursive: true, force: true });
          copied++;
        }
      }

      // Copy MCP servers
      const mcpSrc = path.join(tmpDir, "mcp-servers");
      const mcpDest = path.join(os.homedir(), ".claude", "mcp-servers");
      let mcpCopied = 0;
      if (fs.existsSync(mcpSrc)) {
        if (!fs.existsSync(mcpDest)) fs.mkdirSync(mcpDest, { recursive: true });
        for (const entry of fs.readdirSync(mcpSrc)) {
          const src = path.join(mcpSrc, entry);
          const dest = path.join(mcpDest, entry);
          if (fs.statSync(src).isDirectory()) {
            fs.cpSync(src, dest, { recursive: true, force: true });
            mcpCopied++;
          }
        }
      }

      // Copy tools
      const toolsSrc = path.join(tmpDir, "tools");
      const toolsDest = path.join(os.homedir(), ".claude", "tools");
      if (fs.existsSync(toolsSrc)) {
        if (!fs.existsSync(toolsDest)) fs.mkdirSync(toolsDest, { recursive: true });
        fs.cpSync(toolsSrc, toolsDest, { recursive: true, force: true });
      }

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });

      return NextResponse.json({
        ok: true,
        skillsCopied: copied,
        mcpServersCopied: mcpCopied,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    // Cleanup on error
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Install failed" },
      { status: 500 }
    );
  }
}
