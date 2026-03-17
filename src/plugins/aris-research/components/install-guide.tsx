"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown, ChevronUp, BookOpen, Download, CheckCircle, Loader2, AlertCircle, Terminal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast";

interface InstallStatus {
  installed: string[];
  missing: string[];
  total: number;
  mcpServers: { llmChat: boolean; minimax: boolean };
}

export function InstallGuide() {
  const t = useTranslations("aris");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [installing, setInstalling] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/plugins/aris-research/install");
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      const res = await fetch("/api/plugins/aris-research/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-skills" }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`Installed ${data.skillsCopied} skills + ${data.mcpServersCopied} MCP servers`, "success");
        checkStatus();
      } else {
        toast(data.error || "Install failed", "error");
      }
    } catch {
      toast("Install failed", "error");
    } finally {
      setInstalling(false);
    }
  };

  const allInstalled = status && status.missing.length === 0;

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none py-3 px-4"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="h-4 w-4" />
            {t("install.title")}
            {status && (
              <Badge variant={allInstalled ? "default" : "outline"} className="text-xs ml-1">
                {status.installed.length}/{status.total}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {allInstalled && <CheckCircle className="h-4 w-4 text-green-500" />}
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4 pt-0 space-y-4">
          {/* One-click install */}
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Button
              size="sm"
              disabled={installing || !!allInstalled}
              onClick={handleInstall}
            >
              {installing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Installing...</>
              ) : allInstalled ? (
                <><CheckCircle className="h-3.5 w-3.5" /> All Installed</>
              ) : (
                <><Download className="h-3.5 w-3.5" /> Install ARIS Skills</>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {allInstalled
                ? `${status!.total} skills + MCP servers ready`
                : status
                  ? `${status.missing.length} skills to install`
                  : "Checking..."}
            </span>
          </div>

          {/* MCP status */}
          {status && (
            <div className="flex gap-3 text-xs">
              <span className={status.mcpServers.llmChat ? "text-green-600" : "text-muted-foreground"}>
                {status.mcpServers.llmChat ? "✓" : "○"} llm-chat MCP
              </span>
              <span className={status.mcpServers.minimax ? "text-green-600" : "text-muted-foreground"}>
                {status.mcpServers.minimax ? "✓" : "○"} minimax MCP
              </span>
            </div>
          )}

          {/* How to use */}
          <div>
            <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5" /> How to Run
            </h3>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p><strong>Best for overnight tasks:</strong> Run directly in a terminal with Claude Code CLI, not in the Dashboard chat.</p>
              <div className="bg-muted rounded-md p-3 space-y-1 font-mono">
                <div># Open a persistent terminal (won&apos;t close when you sleep)</div>
                <div className="text-foreground">screen -S research</div>
                <div className="mt-2"># Start the pipeline</div>
                <div className="text-foreground">claude &quot;/research-pipeline your-topic-here&quot;</div>
                <div className="mt-2"># Detach: Ctrl+A then D</div>
                <div># Reattach next morning: screen -r research</div>
              </div>
              <p className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Dashboard Chat is for quick tasks. For long runs, use terminal + screen.
              </p>
            </div>
          </div>

          {/* Configure reviewer */}
          <div>
            <h3 className="text-xs font-semibold mb-1">Configure Reviewer LLM</h3>
            <div className="bg-muted rounded-md p-3 space-y-1 font-mono text-xs">
              <div># Option A: Codex MCP (GPT-5.4)</div>
              <div className="text-foreground">claude mcp add codex -s user -- codex mcp-server</div>
              <div className="mt-2"># Option B: Any API (e.g. DeepSeek)</div>
              <div className="text-foreground">{`# Edit ~/.claude/settings.json → mcpServers → add "llm-chat"`}</div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
