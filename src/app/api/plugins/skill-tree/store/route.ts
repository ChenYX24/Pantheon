import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = path.join(os.homedir(), ".claude", "scc-data", "skill-tree");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  ensureDir();
  const fp = filePath(key);
  if (!fs.existsSync(fp)) return NextResponse.json({ data: null });

  try {
    const raw = fs.readFileSync(fp, "utf-8");
    return NextResponse.json({ data: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ data: null });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { key, data } = body;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  ensureDir();
  const fp = filePath(key);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, fp);

  return NextResponse.json({ ok: true });
}
