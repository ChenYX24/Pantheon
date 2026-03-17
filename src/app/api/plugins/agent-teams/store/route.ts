import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const DATA_DIR = path.join(os.homedir(), ".claude", "scc-data", "teams");
const ALLOWED_KEYS = ["teams", "runs"];

interface Envelope<T = unknown> {
  version: number;
  updatedAt: string | null;
  data: T;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(key: string): string {
  return path.join(DATA_DIR, `${key}.json`);
}

function readEnvelope<T>(key: string): Envelope<T | null> {
  ensureDir();
  const fp = filePath(key);
  if (!fs.existsSync(fp)) {
    return { version: 0, updatedAt: null, data: null };
  }
  try {
    const raw = fs.readFileSync(fp, "utf-8");
    return JSON.parse(raw) as Envelope<T>;
  } catch {
    return { version: 0, updatedAt: null, data: null };
  }
}

function writeEnvelope(key: string, data: unknown, currentVersion: number): Envelope {
  ensureDir();
  const envelope: Envelope = {
    version: currentVersion + 1,
    updatedAt: new Date().toISOString(),
    data,
  };
  const fp = filePath(key);
  const tmp = fp + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), "utf-8");
  fs.renameSync(tmp, fp);
  return envelope;
}

/** GET /api/plugins/agent-teams/store?key=teams */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Invalid key. Allowed: ${ALLOWED_KEYS.join(", ")}` },
      { status: 400 }
    );
  }
  return NextResponse.json(readEnvelope(key));
}

/** PUT /api/plugins/agent-teams/store */
export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { key, data, expectedVersion } = body as {
    key: string;
    data: unknown;
    expectedVersion?: number;
  };

  if (!key || !ALLOWED_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Invalid key. Allowed: ${ALLOWED_KEYS.join(", ")}` },
      { status: 400 }
    );
  }

  const current = readEnvelope(key);

  // Optimistic locking
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    return NextResponse.json(
      { error: "Version conflict", currentVersion: current.version },
      { status: 409 }
    );
  }

  const envelope = writeEnvelope(key, data, current.version);
  return NextResponse.json(envelope);
}
