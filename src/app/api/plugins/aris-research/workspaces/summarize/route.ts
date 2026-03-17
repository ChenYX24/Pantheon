import { NextRequest, NextResponse } from "next/server";
import {
  summarizeWorkspace,
  getWorkspace,
  listWorkspaces,
} from "@/plugins/aris-research/lib/workspace-manager";

// ---------------------------------------------------------------------------
// POST — trigger workspace summarization
// Body: { workspaceId: string }
//
// Reads all .md files in the workspace, concatenates key sections,
// writes summary to agent-docs/knowledge/summary.md.
// Returns { summary, fileCount, totalSize }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspaceId } = body as { workspaceId?: string };

    if (!workspaceId || typeof workspaceId !== "string") {
      return NextResponse.json(
        { error: "workspaceId is required and must be a string" },
        { status: 400 }
      );
    }

    // Verify workspace exists — try by id first, then by pipelineId
    const workspaces = await listWorkspaces();
    const workspace =
      workspaces.find((w) => w.id === workspaceId) ??
      (await getWorkspace(workspaceId));

    if (!workspace) {
      return NextResponse.json(
        { error: `Workspace not found: ${workspaceId}` },
        { status: 404 }
      );
    }

    const summary = await summarizeWorkspace(workspace.id);

    // Extract stats from the summary text
    const fileCountMatch = summary.match(/Files scanned:\s*(\d+)/);
    const totalSizeMatch = summary.match(/Total content size:\s*([\d.]+)\s*KB/);

    return NextResponse.json({
      ok: true,
      summary,
      fileCount: fileCountMatch ? parseInt(fileCountMatch[1], 10) : 0,
      totalSize: totalSizeMatch ? `${totalSizeMatch[1]} KB` : "0 KB",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: `Failed to summarize workspace: ${message}` },
      { status }
    );
  }
}
