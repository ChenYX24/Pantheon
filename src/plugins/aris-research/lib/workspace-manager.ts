/**
 * ARIS Workspace Manager
 *
 * Creates and manages project directories for pipeline runs.
 * Each run gets a folder under E:\claude-projects\ (or user's configured base).
 * All stages write documents into the workspace, and subsequent stages
 * read from previous outputs — enabling persistent, cumulative research.
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS_BASE = process.env.ARIS_PROJECTS_BASE || "E:\\claude-projects";
const INDEX_FILE = path.join(PROJECTS_BASE, ".aris-workspaces.json");

/** Standard directory structure created for each workspace */
const WORKSPACE_DIRS = [
  "agent-docs/plan",
  "agent-docs/knowledge",
  "agent-docs/check_report",
  "agent-docs/debug_fix",
  "agent-docs/adr",
  "agent-docs/templates",
  "agent-docs/backups",
  "ideas",
  "experiments",
  "paper",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceStage {
  stageId: string;
  skillId: string;
  status: "pending" | "running" | "done" | "error";
  outputFiles: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface ArisWorkspace {
  id: string;
  name: string;
  path: string;
  pipelineId: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "archived";
  stages: WorkspaceStage[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Ensure a directory exists (recursive). */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Atomic write: write to .tmp then rename. */
function atomicWriteJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, filePath);
}

/** Read the workspace index, returning an empty array if missing/corrupt. */
function readIndex(): ArisWorkspace[] {
  if (!fs.existsSync(INDEX_FILE)) return [];
  try {
    const raw = fs.readFileSync(INDEX_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist the workspace index atomically. */
function writeIndex(workspaces: ArisWorkspace[]): void {
  atomicWriteJson(INDEX_FILE, workspaces);
}

/**
 * Sanitize a topic string into a kebab-case directory name.
 * - Strip non-alphanumeric chars (keep spaces, hyphens, underscores)
 * - Collapse whitespace, trim, lowercase
 * - Convert spaces/underscores to hyphens
 * - Limit to 50 chars, prefix "aris-"
 */
function topicToName(topic: string): string {
  const cleaned = topic
    .replace(/[^a-zA-Z0-9\s\-_\u4e00-\u9fff]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const truncated = cleaned.slice(0, 50).replace(/-$/, "");
  return `aris-${truncated || "project"}`;
}

/**
 * Given a desired name, find a unique directory name by appending -2, -3, etc.
 */
function uniqueName(desired: string, existing: Set<string>): string {
  if (!existing.has(desired)) return desired;
  let n = 2;
  while (existing.has(`${desired}-${n}`)) {
    n++;
  }
  return `${desired}-${n}`;
}

/**
 * Recursively collect all .md files under a directory (relative paths).
 */
function collectMarkdownFiles(baseDir: string, subDir: string = ""): string[] {
  const results: string[] = [];
  const fullDir = subDir ? path.join(baseDir, subDir) : baseDir;

  if (!fs.existsSync(fullDir)) return results;

  try {
    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = subDir ? path.join(subDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        results.push(...collectMarkdownFiles(baseDir, rel));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(rel);
      }
    }
  } catch {
    // Permission error or similar — skip silently
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new workspace for a pipeline run.
 *
 * - Auto-generates name from topic (sanitized kebab-case, prefixed "aris-")
 * - Deduplicates names by appending -2, -3, etc.
 * - Creates the standard directory structure
 * - Writes CLAUDE.md and ACTIVE_CONTEXT.md
 * - Saves workspace metadata to the index
 */
export async function createWorkspace(opts: {
  pipelineId: string;
  topic: string;
  name?: string;
}): Promise<ArisWorkspace> {
  const workspaces = readIndex();
  const existingNames = new Set(workspaces.map((w) => w.name));

  const baseName = opts.name ? `aris-${opts.name}` : topicToName(opts.topic);
  const name = uniqueName(baseName, existingNames);
  const workspacePath = path.join(PROJECTS_BASE, name);
  const now = new Date().toISOString();

  // Create directory structure
  ensureDir(workspacePath);
  for (const dir of WORKSPACE_DIRS) {
    ensureDir(path.join(workspacePath, dir));
  }

  const workspace: ArisWorkspace = {
    id: `aris-${Date.now()}`,
    name,
    path: workspacePath,
    pipelineId: opts.pipelineId,
    topic: opts.topic,
    createdAt: now,
    updatedAt: now,
    status: "active",
    stages: [],
  };

  // Write CLAUDE.md
  const claudeMd = generateClaudeMd(workspace, opts.topic, "");
  fs.writeFileSync(path.join(workspacePath, "CLAUDE.md"), claudeMd, "utf-8");

  // Write ACTIVE_CONTEXT.md
  const activeCtx = generateActiveContext(workspace);
  fs.writeFileSync(
    path.join(workspacePath, "ACTIVE_CONTEXT.md"),
    activeCtx,
    "utf-8"
  );

  // Write MEMORY.md (empty scaffold)
  fs.writeFileSync(
    path.join(workspacePath, "MEMORY.md"),
    `# Memory\n\n## Key Findings\n\n## Decisions\n\n## Open Questions\n`,
    "utf-8"
  );

  // Update index
  const updated = [workspace, ...workspaces];
  writeIndex(updated);

  return workspace;
}

/** Get workspace by pipeline ID. */
export async function getWorkspace(
  pipelineId: string
): Promise<ArisWorkspace | null> {
  const workspaces = readIndex();
  return workspaces.find((w) => w.pipelineId === pipelineId) ?? null;
}

/** List all workspaces, sorted by most recent first. */
export async function listWorkspaces(): Promise<ArisWorkspace[]> {
  return readIndex();
}

/** Update workspace fields (stage status, name, etc.). */
export async function updateWorkspace(
  id: string,
  updates: Partial<ArisWorkspace>
): Promise<void> {
  const workspaces = readIndex();
  const idx = workspaces.findIndex((w) => w.id === id);
  if (idx === -1) {
    throw new Error(`Workspace not found: ${id}`);
  }

  const current = workspaces[idx];
  const merged: ArisWorkspace = {
    ...current,
    ...updates,
    id: current.id, // never allow overwriting id
    updatedAt: new Date().toISOString(),
  };

  const next = [...workspaces];
  next[idx] = merged;
  writeIndex(next);

  // Re-generate ACTIVE_CONTEXT.md if the workspace directory still exists
  if (fs.existsSync(merged.path)) {
    const activeCtx = generateActiveContext(merged);
    fs.writeFileSync(
      path.join(merged.path, "ACTIVE_CONTEXT.md"),
      activeCtx,
      "utf-8"
    );
  }
}

/** Archive a workspace (mark as archived in index). */
export async function archiveWorkspace(id: string): Promise<void> {
  await updateWorkspace(id, { status: "archived" });
}

/**
 * Generate CLAUDE.md content for the workspace.
 *
 * This file tells Claude (when invoked via `claude -p` inside the workspace)
 * about the research context, directory conventions, and behavioral guidelines.
 */
export function generateClaudeMd(
  workspace: ArisWorkspace,
  topic: string,
  context: string
): string {
  const stageList = workspace.stages
    .map(
      (s) =>
        `- **${s.stageId}** (${s.skillId}): ${s.status}${s.outputFiles.length > 0 ? ` — outputs: ${s.outputFiles.join(", ")}` : ""}`
    )
    .join("\n");

  return `# ARIS Research Workspace

## Research Topic
${topic}

${context ? `## Additional Context\n${context}\n` : ""}
## Workspace Info
- **ID**: ${workspace.id}
- **Pipeline**: ${workspace.pipelineId}
- **Created**: ${workspace.createdAt}
- **Status**: ${workspace.status}

${stageList ? `## Stage Progress\n${stageList}\n` : ""}
## Directory Conventions

| Directory | Purpose |
|-----------|---------|
| \`agent-docs/plan/\` | Research plans and roadmaps |
| \`agent-docs/knowledge/\` | Crystallized insights and summaries |
| \`agent-docs/check_report/\` | Quality gate reports |
| \`agent-docs/debug_fix/\` | Debugging logs and fix records |
| \`agent-docs/adr/\` | Architecture / method decision records |
| \`ideas/\` | Research ideas, brainstorms, exploration notes |
| \`experiments/\` | Experiment configs, scripts, result analysis |
| \`paper/\` | LaTeX source, figures, compiled PDFs |

## Instructions for AI

1. **Read first**: Before starting any task, read existing files in this workspace
   to understand what has already been done. Check \`ACTIVE_CONTEXT.md\` for the
   current state and goals.

2. **Write outputs as markdown**: All research outputs should be written as
   well-structured markdown files in the appropriate directories listed above.

3. **Be thorough and iterate**: Do not produce superficial outputs. Iterate on
   your work until the quality is high. If doing a literature survey, cover at
   least 15-20 papers. If writing a method description, be precise and complete.

4. **Follow the structure**: Place files in the correct directories. Use
   descriptive filenames (e.g., \`literature-survey-vlm-finetuning.md\`, not
   \`output.md\`).

5. **Update ACTIVE_CONTEXT.md**: After completing significant work, update the
   active context file with what was done, what the next steps are, and any
   key decisions made.

6. **Cross-reference**: When your output builds on a previous stage's work,
   reference the specific files you read and explain how your work extends them.

7. **Preserve knowledge**: If you discover something important (a key paper,
   a critical insight, a methodological decision), add it to
   \`agent-docs/knowledge/\` so future stages can benefit.
`;
}

/**
 * Generate ACTIVE_CONTEXT.md for the workspace.
 *
 * This is the "working memory" anchor — updated as stages progress.
 */
export function generateActiveContext(workspace: ArisWorkspace): string {
  const activeStages = workspace.stages.filter(
    (s) => s.status === "running" || s.status === "pending"
  );
  const doneStages = workspace.stages.filter((s) => s.status === "done");
  const errorStages = workspace.stages.filter((s) => s.status === "error");

  const currentGoal =
    activeStages.length > 0
      ? `Execute stage: ${activeStages.map((s) => s.stageId).join(", ")}`
      : doneStages.length > 0
        ? "All stages completed — review and consolidate outputs"
        : "Pipeline initialized — waiting for first stage execution";

  const outputList = doneStages
    .flatMap((s) =>
      s.outputFiles.map((f) => `- \`${f}\` (from ${s.stageId})`)
    )
    .join("\n");

  return `# Active Context

## Goal
${currentGoal}

## Research Topic
${workspace.topic}

## Pipeline
- **ID**: ${workspace.pipelineId}
- **Status**: ${workspace.status}
- **Last Updated**: ${workspace.updatedAt}

## Stage Status
${
  workspace.stages.length > 0
    ? workspace.stages
        .map((s) => {
          const icon =
            s.status === "done"
              ? "[x]"
              : s.status === "running"
                ? "[~]"
                : s.status === "error"
                  ? "[!]"
                  : "[ ]";
          return `- ${icon} **${s.stageId}** (${s.skillId}): ${s.status}`;
        })
        .join("\n")
    : "No stages executed yet."
}

${outputList ? `## Available Outputs\n${outputList}\n` : ""}
${errorStages.length > 0 ? `## Errors\n${errorStages.map((s) => `- **${s.stageId}**: needs investigation`).join("\n")}\n` : ""}
## Validation
- Check stage outputs exist in the correct directories
- Verify markdown files are well-structured and complete
- Ensure cross-references between stage outputs are valid

## Version Status
- **Git**: N/A (workspace-managed)
- **Backup**: \`agent-docs/backups/\`
`;
}

/**
 * Summarize/consolidate a workspace.
 *
 * Reads all .md files in agent-docs/, ideas/, experiments/ and creates
 * a structured summary at agent-docs/knowledge/summary.md.
 */
export async function summarizeWorkspace(id: string): Promise<string> {
  const workspaces = readIndex();
  const workspace = workspaces.find((w) => w.id === id);
  if (!workspace) {
    throw new Error(`Workspace not found: ${id}`);
  }

  if (!fs.existsSync(workspace.path)) {
    throw new Error(`Workspace directory does not exist: ${workspace.path}`);
  }

  // Collect markdown files from relevant directories
  const scanDirs = ["agent-docs", "ideas", "experiments"];
  const allFiles: { relativePath: string; content: string; size: number }[] =
    [];

  for (const dir of scanDirs) {
    const mdFiles = collectMarkdownFiles(workspace.path, dir);
    for (const relFile of mdFiles) {
      // Skip the summary file itself to avoid recursion
      if (relFile === path.join("agent-docs", "knowledge", "summary.md")) {
        continue;
      }
      try {
        const fullPath = path.join(workspace.path, relFile);
        const content = fs.readFileSync(fullPath, "utf-8");
        allFiles.push({
          relativePath: relFile,
          content,
          size: Buffer.byteLength(content, "utf-8"),
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  // Also read top-level ACTIVE_CONTEXT.md and MEMORY.md
  for (const topFile of ["ACTIVE_CONTEXT.md", "MEMORY.md"]) {
    const fullPath = path.join(workspace.path, topFile);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        allFiles.push({
          relativePath: topFile,
          content,
          size: Buffer.byteLength(content, "utf-8"),
        });
      } catch {
        // Skip
      }
    }
  }

  // Build summary
  const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
  const now = new Date().toISOString();

  const fileSections = allFiles
    .map((f) => {
      // Extract first heading and first paragraph as a brief
      const lines = f.content.split("\n");
      const heading =
        lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "") || "(no heading)";
      const firstPara = lines
        .filter((l) => l.trim() && !l.startsWith("#"))
        .slice(0, 3)
        .join(" ")
        .slice(0, 200);

      return `### ${f.relativePath}\n- **Title**: ${heading}\n- **Size**: ${f.size} bytes\n- **Preview**: ${firstPara}${firstPara.length >= 200 ? "..." : ""}`;
    })
    .join("\n\n");

  const summary = `# Workspace Summary

> Auto-generated on ${now}

## Overview
- **Workspace**: ${workspace.name}
- **Topic**: ${workspace.topic}
- **Status**: ${workspace.status}
- **Pipeline**: ${workspace.pipelineId}
- **Files scanned**: ${allFiles.length}
- **Total content size**: ${(totalSize / 1024).toFixed(1)} KB

## Stage Progress
${
  workspace.stages.length > 0
    ? workspace.stages
        .map(
          (s) =>
            `- **${s.stageId}** (${s.skillId}): ${s.status}${s.completedAt ? ` — completed ${s.completedAt}` : ""}`
        )
        .join("\n")
    : "No stages recorded yet."
}

## File Index

${fileSections || "No markdown files found."}
`;

  // Write summary to knowledge directory
  const summaryPath = path.join(
    workspace.path,
    "agent-docs",
    "knowledge",
    "summary.md"
  );
  ensureDir(path.dirname(summaryPath));
  fs.writeFileSync(summaryPath, summary, "utf-8");

  return summary;
}
