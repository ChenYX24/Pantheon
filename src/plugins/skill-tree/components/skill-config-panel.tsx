"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Loader2 } from "lucide-react";
import type { SkillConfigField, SkillConfig } from "../types";
import { getSkillConfig, saveSkillConfig } from "../skill-tree-store";

interface SkillConfigPanelProps {
  skillId: string;
  fields: SkillConfigField[];
  isZh: boolean;
  onConfigSaved?: () => void;
}

export function SkillConfigPanel({
  skillId,
  fields,
  isZh,
  onConfigSaved,
}: SkillConfigPanelProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load saved config
  useEffect(() => {
    getSkillConfig(skillId).then((config) => {
      const merged: Record<string, string> = {};
      for (const field of fields) {
        merged[field.key] = config.params[field.key] ?? field.defaultValue ?? "";
      }
      setValues(merged);
      setLoaded(true);
    });
  }, [skillId, fields]);

  const updateValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const config: SkillConfig = { params: { ...values } };
    await saveSkillConfig(skillId, config);
    setSaving(false);
    onConfigSaved?.();
  }, [skillId, values, onConfigSaved]);

  if (!loaded) return null;

  return (
    <div className="bg-sky-500/5 border border-sky-500/15 rounded-lg p-3 space-y-3">
      <div className="text-[11px] font-semibold text-sky-400">
        {isZh ? "参数配置" : "Configuration"}
      </div>

      {fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-[10px] font-medium text-muted-foreground">
            {isZh ? field.labelZh : field.label}
          </label>

          {field.type === "select" && field.options ? (
            field.allowCustom ? (
              /* Select with custom input fallback */
              <div className="space-y-1">
                <Select
                  value={
                    field.options.some((o) => o.value === values[field.key])
                      ? values[field.key]
                      : "__custom__"
                  }
                  onValueChange={(v) => {
                    if (v !== "__custom__") updateValue(field.key, v);
                  }}
                >
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder={field.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="text-[10px]">
                          {isZh ? opt.labelZh : opt.label}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">
                      <span className="text-[10px] text-muted-foreground italic">
                        {isZh ? "自定义..." : "Custom..."}
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                {/* Show custom input if value is not in predefined options */}
                {!field.options.some((o) => o.value === values[field.key]) && (
                  <Input
                    className="h-7 text-[10px]"
                    placeholder={field.placeholder}
                    value={values[field.key] ?? ""}
                    onChange={(e) => updateValue(field.key, e.target.value)}
                  />
                )}
              </div>
            ) : (
              /* Simple select */
              <Select
                value={values[field.key] ?? ""}
                onValueChange={(v) => updateValue(field.key, v)}
              >
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue placeholder={field.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="text-[10px]">
                        {isZh ? opt.labelZh : opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            /* Text or number input */
            <Input
              className="h-7 text-[10px]"
              type={field.type === "number" ? "number" : "text"}
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={(e) => updateValue(field.key, e.target.value)}
            />
          )}
        </div>
      ))}

      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-[10px] gap-1.5 border-sky-500/20 text-sky-400 hover:text-sky-300 hover:border-sky-500/40"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        {saving
          ? (isZh ? "保存中..." : "Saving...")
          : (isZh ? "保存配置" : "Save Config")}
      </Button>
    </div>
  );
}
