/**
 * API route to browse directories for CLAUDE.md creation
 * GET /api/browse?path=xxx - List subdirectories of a path
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { isPathAllowed } from "@/lib/path-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dirPath = searchParams.get("path");

    // Open folder in system file explorer
    const openPath = searchParams.get("open");
    if (openPath && isPathAllowed(openPath)) {
      const { exec } = await import("child_process");
      const normalizedPath = path.resolve(openPath);
      if (fs.existsSync(normalizedPath)) {
        const cmd = process.platform === "win32"
          ? `explorer "${normalizedPath}"`
          : process.platform === "darwin"
            ? `open "${normalizedPath}"`
            : `xdg-open "${normalizedPath}"`;
        exec(cmd);
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "Path not found" }, { status: 404 });
    }

    // Special: list drive roots
    if (!dirPath || dirPath === "__drives__") {
      const drives: { name: string; path: string; isDir: boolean; hasClaudeMd: boolean }[] = [];
      const isWin = process.platform === "win32";
      if (isWin) {
        for (const letter of ["C", "D", "E", "F", "G", "H"]) {
          const root = `${letter}:\\`;
          try {
            if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
              drives.push({
                name: `${letter}:`,
                path: root,
                isDir: true,
                hasClaudeMd: fs.existsSync(path.join(root, "CLAUDE.md")),
              });
            }
          } catch { /* skip */ }
        }
      } else {
        for (const root of ["/home", "/Users", "/mnt", "/opt", os.homedir()]) {
          try {
            if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
              drives.push({
                name: root,
                path: root,
                isDir: true,
                hasClaudeMd: fs.existsSync(path.join(root, "CLAUDE.md")),
              });
            }
          } catch { /* skip */ }
        }
      }
      return NextResponse.json({
        current: isWin ? "My Computer" : "/",
        parent: null,
        hasClaudeMd: false,
        entries: drives,
        isDriveList: true,
      });
    }

    const resolved = path.resolve(dirPath);
    if (!isPathAllowed(resolved)) {
      return NextResponse.json(
        { error: "Path not allowed" },
        { status: 403 }
      );
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json(
        { error: "Path does not exist" },
        { status: 404 }
      );
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: "Not a directory" },
        { status: 400 }
      );
    }

    const entries: { name: string; path: string; isDir: boolean; hasClaudeMd: boolean }[] = [];

    const items = fs.readdirSync(resolved);
    for (const item of items) {
      // Skip hidden dirs and node_modules
      if (item.startsWith(".") || item === "node_modules" || item === "__pycache__") continue;

      const fullPath = path.join(resolved, item);
      try {
        const itemStat = fs.statSync(fullPath);
        if (itemStat.isDirectory()) {
          const hasClaudeMd = fs.existsSync(path.join(fullPath, "CLAUDE.md"));
          entries.push({
            name: item,
            path: fullPath,
            isDir: true,
            hasClaudeMd,
          });
        }
      } catch { /* skip permission errors */ }
    }

    // Sort: dirs with CLAUDE.md first, then alphabetical
    entries.sort((a, b) => {
      if (a.hasClaudeMd !== b.hasClaudeMd) return a.hasClaudeMd ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parentDir = path.dirname(resolved);
    const hasClaudeMd = fs.existsSync(path.join(resolved, "CLAUDE.md"));

    return NextResponse.json({
      current: resolved,
      parent: parentDir !== resolved ? parentDir : null,
      hasClaudeMd,
      entries,
    });
  } catch (error) {
    console.error("Browse error:", error);
    return NextResponse.json(
      { error: "Failed to browse directory" },
      { status: 500 }
    );
  }
}
