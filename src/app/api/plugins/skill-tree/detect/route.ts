import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";

interface DetectRequest {
  command: string;
}

interface DetectResponse {
  success: boolean;
  output: string;
}

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_LENGTH = 2000;

function sanitizeCommand(command: string): boolean {
  const dangerous = [/rm\s+-rf/, /mkfs/, /dd\s+if=/, />\s*\/dev\//, /fork\s*bomb/i];
  return !dangerous.some((re) => re.test(command));
}

/**
 * Decode a Buffer that may be GBK (Windows cmd.exe) or UTF-8.
 * Try UTF-8 first; if it has replacement chars and we're on Windows, try GBK via TextDecoder.
 */
function decodeOutput(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  // If no replacement characters, UTF-8 is fine
  if (!utf8.includes("\ufffd") && !/[\x80-\xff]/.test(utf8)) return utf8;
  // On Windows, try GBK (cp936) decoding
  if (process.platform === "win32") {
    try {
      return new TextDecoder("gbk").decode(buf);
    } catch {
      // TextDecoder('gbk') not available, fall through
    }
  }
  return utf8;
}

export async function POST(req: NextRequest): Promise<NextResponse<DetectResponse>> {
  try {
    const body = (await req.json()) as DetectRequest;
    const { command } = body;

    if (!command || typeof command !== "string") {
      return NextResponse.json(
        { success: false, output: "Missing or invalid command" },
        { status: 400 }
      );
    }

    if (command.length > 500) {
      return NextResponse.json(
        { success: false, output: "Command too long" },
        { status: 400 }
      );
    }

    if (!sanitizeCommand(command)) {
      return NextResponse.json(
        { success: false, output: "Command blocked for safety" },
        { status: 400 }
      );
    }

    const result = await new Promise<DetectResponse>((resolve) => {
      exec(
        command,
        { timeout: TIMEOUT_MS, windowsHide: true, encoding: "buffer" },
        (error, stdoutBuf, stderrBuf) => {
          const stdout = decodeOutput(stdoutBuf as unknown as Buffer);
          const stderr = decodeOutput(stderrBuf as unknown as Buffer);
          const output = (stdout || stderr || "").trim().slice(0, MAX_OUTPUT_LENGTH);
          if (error) {
            resolve({ success: false, output: output || error.message });
          } else {
            resolve({ success: true, output });
          }
        }
      );
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, output: message },
      { status: 500 }
    );
  }
}
