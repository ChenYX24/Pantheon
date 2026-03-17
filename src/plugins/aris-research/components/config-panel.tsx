"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings2, Save, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ArisConfig } from "../types";
import { getArisConfig, setArisConfig } from "../aris-store";

export function ConfigPanel() {
  const t = useTranslations("aris");
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ArisConfig>(getArisConfig);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) setConfig(getArisConfig());
  }, [open]);

  const update = (patch: Partial<ArisConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  };

  const handleSave = () => {
    setArisConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="h-3 w-3" />
        <span className="hidden sm:inline">{t("config.title")}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings2 className="h-4 w-4" />
              {t("config.title")}
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-normal">Global</Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Shared across all views. Sets defaults for reviewer, venue, GPU budget, etc.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Reviewer Model */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.reviewerModel")}</label>
              <Select value={config.reviewerModel} onValueChange={(v) => update({ reviewerModel: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-opus-4-6">Claude Opus 4.6</SelectItem>
                  <SelectItem value="claude-sonnet-4-6">Claude Sonnet 4.6</SelectItem>
                  <SelectItem value="claude-haiku-4-5-20251001">Claude Haiku 4.5</SelectItem>
                  <SelectItem value="o3">OpenAI o3</SelectItem>
                  <SelectItem value="o4-mini">OpenAI o4-mini</SelectItem>
                  <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
                  <SelectItem value="codex-4.5">Codex 4.5</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reviewer Provider */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.reviewerProvider")}</label>
              <Select value={config.reviewerProvider} onValueChange={(v) => update({ reviewerProvider: v as ArisConfig["reviewerProvider"] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="codex-mcp">Codex MCP</SelectItem>
                  <SelectItem value="llm-chat-mcp">LLM Chat MCP</SelectItem>
                  <SelectItem value="minimax-mcp">MiniMax MCP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Venue */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.venue")}</label>
              <Select value={config.venue} onValueChange={(v) => update({ venue: v as ArisConfig["venue"] })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(["ICLR", "NeurIPS", "ICML", "AAAI", "ACL"] as const).map((v) => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max Rounds */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.maxRounds")}</label>
              <Input type="number" className="h-8 text-xs" min={1} max={10}
                value={config.maxRounds}
                onChange={(e) => update({ maxRounds: parseInt(e.target.value, 10) || 4 })}
              />
            </div>

            {/* Pilot Max Hours */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.pilotMaxHours")}</label>
              <Input type="number" className="h-8 text-xs" min={0.5} step={0.5}
                value={config.pilotMaxHours}
                onChange={(e) => update({ pilotMaxHours: parseFloat(e.target.value) || 2 })}
              />
            </div>

            {/* Max GPU Hours */}
            <div className="space-y-1">
              <label className="text-xs font-medium">{t("config.maxGpuHours")}</label>
              <Input type="number" className="h-8 text-xs" min={1}
                value={config.maxTotalGpuHours}
                onChange={(e) => update({ maxTotalGpuHours: parseInt(e.target.value, 10) || 24 })}
              />
            </div>

            {/* Auto Proceed */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">{t("config.autoProceed")}</label>
              <Switch size="sm" checked={config.autoProceed} onCheckedChange={(v) => update({ autoProceed: v })} />
            </div>

            {/* Human Checkpoint */}
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">{t("config.humanCheckpoint")}</label>
              <Switch size="sm" checked={config.humanCheckpoint} onCheckedChange={(v) => update({ humanCheckpoint: v })} />
            </div>

            {/* Feishu Webhook */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-medium">{t("config.feishuWebhook")}</label>
              <Input className="h-8 text-xs" placeholder="https://open.feishu.cn/..."
                value={config.feishuWebhook ?? ""}
                onChange={(e) => update({ feishuWebhook: e.target.value || undefined })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" className="gap-1.5" onClick={handleSave}>
              {saved ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
