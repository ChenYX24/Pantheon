import { NextRequest, NextResponse } from "next/server";
import {
  createWorkspace,
  listWorkspaces,
  updateWorkspace,
  archiveWorkspace,
} from "@/plugins/aris-research/lib/workspace-manager";

// ---------------------------------------------------------------------------
// GET — list all workspaces
// Optional query: ?status=active|completed|archived
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status");
    let workspaces = await listWorkspaces();

    if (status && ["active", "completed", "archived"].includes(status)) {
      workspaces = workspaces.filter((w) => w.status === status);
    }

    return NextResponse.json({ workspaces });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to list workspaces: ${message}` },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a new workspace
// Body: { pipelineId: string, topic: string, name?: string }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pipelineId, topic, name } = body as {
      pipelineId?: string;
      topic?: string;
      name?: string;
    };

    if (!pipelineId || typeof pipelineId !== "string") {
      return NextResponse.json(
        { error: "pipelineId is required and must be a string" },
        { status: 400 }
      );
    }

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "topic is required and must be a string" },
        { status: 400 }
      );
    }

    const workspace = await createWorkspace({ pipelineId, topic, name });
    return NextResponse.json({ ok: true, workspace });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to create workspace: ${message}` },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — update a workspace
// Body: { id: string, updates: Partial<ArisWorkspace> }
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, updates } = body as {
      id?: string;
      updates?: Record<string, unknown>;
    };

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "id is required and must be a string" },
        { status: 400 }
      );
    }

    if (!updates || typeof updates !== "object") {
      return NextResponse.json(
        { error: "updates object is required" },
        { status: 400 }
      );
    }

    await updateWorkspace(id, updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: `Failed to update workspace: ${message}` },
      { status }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — archive a workspace
// Query: ?id=aris-1234567890
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "id query parameter is required" },
        { status: 400 }
      );
    }

    await archiveWorkspace(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { error: `Failed to archive workspace: ${message}` },
      { status }
    );
  }
}
