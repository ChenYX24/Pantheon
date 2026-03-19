import { NextRequest, NextResponse } from "next/server";
import { validateKey } from "@/lib/api-vault/provider-checker";

export async function POST(req: NextRequest) {
  try {
    const { provider, key, base_url } = await req.json();

    if (!provider || !key) {
      return NextResponse.json(
        { error: "provider and key are required" },
        { status: 400 }
      );
    }

    if (typeof key !== "string" || key.trim().length < 4) {
      return NextResponse.json(
        { error: "key must be at least 4 characters" },
        { status: 400 }
      );
    }

    // Strip non-ASCII characters that cause ByteString errors in HTTP headers
    // eslint-disable-next-line no-control-regex
    const cleanKey = key.replace(/[^\x20-\x7E]/g, "").trim();
    if (cleanKey.length < 4) {
      return NextResponse.json(
        { error: "API key contains invalid characters. Please re-enter the key without copying from PDFs or formatted text." },
        { status: 400 }
      );
    }

    const result = await validateKey(
      String(provider),
      cleanKey,
      base_url ? String(base_url) : undefined
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
