import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/** Node summary for report generation */
interface NodeSummary {
  id: string;
  skillName: string;
  skillNameZh: string;
  status: "done" | "error" | "skipped" | "idle" | "queued" | "running";
  durationMs: number;
  errorMessage?: string;
  outputDir?: string;
}

interface ReportRequest {
  pipelineName: string;
  pipelineNameZh: string;
  workspacePath: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  nodes: NodeSummary[];
  logs: string[];
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusEmoji(status: string): string {
  switch (status) {
    case "done": return "OK";
    case "error": return "FAIL";
    case "skipped": return "SKIP";
    default: return status.toUpperCase();
  }
}

function generateMarkdown(data: ReportRequest): string {
  const lines: string[] = [];

  lines.push(`# Execution Report: ${data.pipelineName}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Pipeline | ${data.pipelineName} |`);
  lines.push(`| Started | ${data.startedAt} |`);
  lines.push(`| Completed | ${data.completedAt} |`);
  lines.push(`| Duration | ${formatDuration(data.totalDurationMs)} |`);
  lines.push(`| Workspace | \`${data.workspacePath}\` |`);
  lines.push("");

  // Summary counts
  const doneCount = data.nodes.filter((n) => n.status === "done").length;
  const errorCount = data.nodes.filter((n) => n.status === "error").length;
  const skippedCount = data.nodes.filter((n) => n.status === "skipped").length;
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- **Total nodes**: ${data.nodes.length}`);
  lines.push(`- **Succeeded**: ${doneCount}`);
  lines.push(`- **Failed**: ${errorCount}`);
  lines.push(`- **Skipped**: ${skippedCount}`);
  lines.push("");

  // Per-node table
  lines.push(`## Node Details`);
  lines.push("");
  lines.push(`| # | Skill | Status | Duration | Output Dir |`);
  lines.push(`|---|-------|--------|----------|------------|`);
  data.nodes.forEach((node, i) => {
    const dur = node.durationMs > 0 ? formatDuration(node.durationMs) : "-";
    const outDir = node.outputDir ?? "-";
    lines.push(`| ${i + 1} | ${node.skillName} | ${statusEmoji(node.status)} | ${dur} | ${outDir} |`);
  });
  lines.push("");

  // Error details
  const errorNodes = data.nodes.filter((n) => n.status === "error" && n.errorMessage);
  if (errorNodes.length > 0) {
    lines.push(`## Errors`);
    lines.push("");
    for (const node of errorNodes) {
      lines.push(`### ${node.skillName}`);
      lines.push("");
      lines.push("```");
      lines.push(node.errorMessage ?? "Unknown error");
      lines.push("```");
      lines.push("");
    }
  }

  // Timestamp
  lines.push("---");
  lines.push(`*Generated at ${new Date().toISOString()}*`);

  return lines.join("\n");
}

/**
 * POST /api/plugins/aris-research/report
 *
 * Generates a Markdown execution report and optionally saves it to the workspace.
 * Body: ReportRequest
 * Returns: { markdown: string, savedPath?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReportRequest;

    if (!body.pipelineName || !body.nodes) {
      return NextResponse.json(
        { error: "pipelineName and nodes are required" },
        { status: 400 }
      );
    }

    const markdown = generateMarkdown(body);

    // Save to workspace if path provided
    let savedPath: string | undefined;
    if (body.workspacePath) {
      const reportDir = path.join(body.workspacePath, "agent-docs", "check_report");
      try {
        fs.mkdirSync(reportDir, { recursive: true });
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        const fileName = `execution-report_${timestamp}.md`;
        const filePath = path.join(reportDir, fileName);
        fs.writeFileSync(filePath, markdown, "utf-8");
        savedPath = filePath;
      } catch (fsErr) {
        // Non-critical: report is still returned even if save fails
        console.error("Failed to save report file:", fsErr);
      }
    }

    return NextResponse.json({ markdown, savedPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to generate report: ${message}` },
      { status: 500 }
    );
  }
}
