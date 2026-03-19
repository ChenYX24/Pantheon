/**
 * Reveal (decrypt) a stored API key for clipboard copy.
 * GET /api/plugins/api-management/keys/reveal?id=...
 */

import { NextRequest, NextResponse } from "next/server";
import { getKey, getDecryptedKey } from "@/lib/api-vault/key-store";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const keyRecord = getKey(id);
    if (!keyRecord) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const decrypted = getDecryptedKey(id);
    if (!decrypted) {
      return NextResponse.json({ error: "Failed to decrypt key" }, { status: 500 });
    }

    return NextResponse.json({ key: decrypted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const isCorrupted = message.includes("decryption failed");
    return NextResponse.json(
      {
        error: isCorrupted
          ? "Key decryption failed — hostname may have changed. Please delete and re-enter this key."
          : message,
        corrupted: isCorrupted,
      },
      { status: isCorrupted ? 422 : 500 }
    );
  }
}
