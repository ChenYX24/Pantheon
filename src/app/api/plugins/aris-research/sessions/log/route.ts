import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

/** GET /api/plugins/aris-research/sessions/log?path=xxx&tail=100 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const logPath = searchParams.get("path");
  const tail = parseInt(searchParams.get("tail") ?? "100", 10);

  if (!logPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  if (!fs.existsSync(logPath)) {
    return NextResponse.json({ content: "(log file not yet created)", lines: 0 });
  }

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    // Return last N lines
    const sliced = lines.slice(-tail).join("\n");

    return NextResponse.json({
      content: sliced,
      lines: totalLines,
      completed: content.includes("=== SESSION COMPLETED ==="),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
