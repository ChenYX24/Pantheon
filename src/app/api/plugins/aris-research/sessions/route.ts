import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const SESSIONS_DIR = path.join(os.homedir(), ".claude", "aris-sessions");
const SESSIONS_INDEX = path.join(SESSIONS_DIR, "sessions.json");

interface ArisSession {
  id: string;
  skill: string;
  command: string;
  pid: number | null;
  logFile: string;
  status: "running" | "completed" | "error" | "unknown";
  startedAt: string;
  endedAt: string | null;
}

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function readSessions(): ArisSession[] {
  ensureDir();
  if (!fs.existsSync(SESSIONS_INDEX)) return [];
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_INDEX, "utf-8"));
  } catch {
    return [];
  }
}

function writeSessions(sessions: ArisSession[]) {
  ensureDir();
  fs.writeFileSync(SESSIONS_INDEX, JSON.stringify(sessions, null, 2));
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if session is truly done by reading its log file */
function isSessionCompletedByLog(logFile: string): "completed" | "error" | "running" {
  try {
    if (!fs.existsSync(logFile)) return "running";
    const content = fs.readFileSync(logFile, "utf-8");
    if (content.includes("=== SESSION COMPLETED ===")) return "completed";
    if (content.includes("ERROR:")) return "error";
    return "running";
  } catch {
    return "running";
  }
}

/** Check if a PowerShell window with our script is still running */
function isSessionProcessRunning(session: ArisSession): boolean {
  // First check PID (works for direct spawn, not cmd.exe /c start)
  if (session.pid && isProcessRunning(session.pid)) return true;
  // Fallback: check if the .ps1 script file is locked or if log was recently modified
  try {
    const logStat = fs.statSync(session.logFile);
    const ageMs = Date.now() - logStat.mtimeMs;
    // If log was modified in last 30 seconds, consider still running
    if (ageMs < 30000) return true;
  } catch {
    // log file doesn't exist yet — could be starting up
  }
  return false;
}

/** GET — list all sessions with live status check */
export async function GET() {
  const sessions = readSessions();

  // Update status for running sessions
  const updated = sessions.map((s) => {
    if (s.status === "running") {
      // Primary: check log file for completion markers
      const logStatus = isSessionCompletedByLog(s.logFile);
      if (logStatus === "completed") {
        return { ...s, status: "completed" as const, endedAt: new Date().toISOString() };
      }
      if (logStatus === "error") {
        return { ...s, status: "error" as const, endedAt: new Date().toISOString() };
      }
      // Secondary: if no log markers, check if process is truly dead (with grace period)
      if (!isSessionProcessRunning(s)) {
        // Process gone + no completion marker = check how old
        const startAge = Date.now() - new Date(s.startedAt).getTime();
        // Give at least 60s grace period for process to start writing logs
        if (startAge > 60000) {
          return { ...s, status: "completed" as const, endedAt: new Date().toISOString() };
        }
      }
    }
    return s;
  });

  // Check if any status changed
  if (JSON.stringify(updated) !== JSON.stringify(sessions)) {
    writeSessions(updated);
  }

  return NextResponse.json({ sessions: updated });
}

/** POST — launch a new session */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { skill, command, workspacePath, stageContext, iterateUntilSatisfied } = body as {
    skill: string;
    command: string;
    workspacePath?: string;
    stageContext?: string;
    iterateUntilSatisfied?: boolean;
  };

  if (!command) {
    return NextResponse.json({ error: "command is required" }, { status: 400 });
  }

  ensureDir();

  const sessionId = `aris-${Date.now()}`;
  const logFile = path.join(SESSIONS_DIR, `${sessionId}.log`);

  // Find claude executable
  const claudePath = path.join(os.homedir(), ".local", "bin", "claude.exe");
  const claudeCmd = fs.existsSync(claudePath) ? claudePath : "claude";

  // Create the PowerShell script that runs claude
  const psScript = path.join(SESSIONS_DIR, `${sessionId}.ps1`);
  // Escape for PowerShell: backslashes in paths
  const escapedLogFile = logFile.replace(/\\/g, "\\\\");
  const escapedClaudePath = claudeCmd.replace(/\\/g, "\\\\");
  // For log messages: escape double quotes so PS string literals don't break
  const safeCommand = command.replace(/"/g, '`"');
  const safeSkill = skill.replace(/"/g, '`"');

  // Detect git-bash path for Claude Code on Windows
  const gitBashCandidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    path.join(os.homedir(), "..", "..", "App_Code", "Git", "bin", "bash.exe"),
    "E:\\App_Code\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  const gitBashPath = gitBashCandidates.find((p) => p && fs.existsSync(p)) ?? "";

  // Build the prompt depending on whether workspace mode is enabled
  const useWorkspaceMode = !!workspacePath;
  let promptBlock: string;

  if (useWorkspaceMode) {
    // Workspace-aware mode: build a rich prompt with context
    const iterationInstructions = iterateUntilSatisfied
      ? `
## Iteration
After completing your initial work, review your output critically:
- Is it comprehensive enough?
- Are there gaps or missing perspectives?
- Would a reviewer find issues?
If not satisfied, iterate and improve before finishing.`
      : "";

    const stageContextBlock = stageContext
      ? `
## Previous Stage Outputs
${stageContext.replace(/'/g, "''")}
Read these files for context and build upon them.`
      : "";

    // Use a PS here-string to avoid all quoting issues
    promptBlock = `$prompt = @'
You are running as part of an ARIS research pipeline.

## Current Task
${command}

## Workspace
Working directory: ${workspacePath}
Read existing files for context before starting.

## Instructions
- Write all outputs as markdown files in the appropriate directories
- Be thorough. If your first attempt is not comprehensive enough, iterate and expand.
- Follow the workspace structure conventions
${stageContextBlock}${iterationInstructions}

## Output Conventions
- Literature reviews -> agent-docs/knowledge/
- Ideas and brainstorming -> ideas/
- Experiment plans -> agent-docs/plan/
- Novelty/review reports -> agent-docs/check_report/
- Code and scripts -> experiments/
- Paper drafts -> paper/
'@`;
  } else {
    // Legacy mode: simple single-shot prompt
    const escapedCmd = command.replace(/'/g, "''");
    promptBlock = `$prompt = '${escapedCmd}'`;
  }

  // Build the claude invocation line
  const cwdArg = useWorkspaceMode
    ? ` --cwd '${workspacePath!.replace(/'/g, "''")}'`
    : "";

  const psContent = `$ErrorActionPreference = 'Continue'
$logFile = '${escapedLogFile}'
$claudePath = '${escapedClaudePath}'
${gitBashPath ? `$env:CLAUDE_CODE_GIT_BASH_PATH = '${gitBashPath.replace(/'/g, "''")}'` : "# git-bash not found, Claude may fail on Windows"}

"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting: ${safeCommand}" | Out-File -FilePath $logFile -Encoding utf8
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Skill: ${safeSkill}" | Out-File -FilePath $logFile -Append -Encoding utf8
"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Claude: $claudePath" | Out-File -FilePath $logFile -Append -Encoding utf8
${useWorkspaceMode ? `"[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Workspace: ${workspacePath!.replace(/"/g, '`"')}" | Out-File -FilePath $logFile -Append -Encoding utf8` : ""}
"---" | Out-File -FilePath $logFile -Append -Encoding utf8

${promptBlock}

try {
  & $claudePath -p $prompt${cwdArg} 2>&1 | ForEach-Object {
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $_"
    $line | Out-File -FilePath $logFile -Append -Encoding utf8
    Write-Host $_
  }
  "" | Out-File -FilePath $logFile -Append -Encoding utf8
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] === SESSION COMPLETED ===" | Out-File -FilePath $logFile -Append -Encoding utf8
} catch {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: $_" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Start-Sleep -Seconds 2
`;

  fs.writeFileSync(psScript, psContent, "utf-8");

  // Ensure workspace directory exists when provided
  if (workspacePath && !fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  // Launch in a new visible PowerShell window (survives browser close)
  const child = spawn("cmd.exe", [
    "/c", "start",
    `ARIS: ${skill}`,
    "powershell.exe",
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psScript,
  ], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const session: ArisSession = {
    id: sessionId,
    skill,
    command,
    pid: child.pid ?? null,
    logFile,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
  };

  const sessions = readSessions();
  sessions.unshift(session);
  writeSessions(sessions);

  return NextResponse.json({ ok: true, session });
}

/** DELETE — remove a session record */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const sessions = readSessions().filter((s) => s.id !== id);
  writeSessions(sessions);

  return NextResponse.json({ ok: true });
}
