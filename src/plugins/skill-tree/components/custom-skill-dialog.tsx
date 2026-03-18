"use client";

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { X, Plus, Loader2 } from "lucide-react";
import type {
  SkillTreeNode,
  SkillCategory,
  ImplType,
  CustomSkill,
} from "../types";
import { CATEGORIES } from "../skill-tree-data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormData {
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  category: SkillCategory;
  tier: number;
  implType: ImplType;
  tags: string;
  dependencies: string[];
  icon: string;
}

const EMPTY_FORM: FormData = {
  name: "",
  nameZh: "",
  description: "",
  descriptionZh: "",
  category: "other",
  tier: 2,
  implType: "manual",
  tags: "",
  dependencies: [],
  icon: "Puzzle",
};

const IMPL_TYPES: { value: ImplType; key: string }[] = [
  { value: "cli", key: "cli" },
  { value: "skill", key: "skill" },
  { value: "mcp", key: "mcp" },
  { value: "plugin", key: "plugin" },
  { value: "api", key: "api" },
  { value: "manual", key: "manual" },
  { value: "planned", key: "planned" },
];

function formToSkill(form: FormData, existingId?: string): Omit<CustomSkill, "isCustom" | "createdAt"> {
  return {
    id: existingId ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: form.name.trim(),
    nameZh: form.nameZh.trim() || form.name.trim(),
    description: form.description.trim(),
    descriptionZh: form.descriptionZh.trim() || form.description.trim(),
    category: form.category,
    defaultStatus: "active",
    icon: form.icon || "Puzzle",
    implType: form.implType,
    dependencies: form.dependencies,
    tier: form.tier,
    tags: form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

function skillToForm(skill: SkillTreeNode): FormData {
  return {
    name: skill.name,
    nameZh: skill.nameZh,
    description: skill.description,
    descriptionZh: skill.descriptionZh,
    category: skill.category,
    tier: skill.tier,
    implType: skill.implType,
    tags: skill.tags?.join(", ") ?? "",
    dependencies: [...skill.dependencies],
    icon: skill.icon,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CustomSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allSkills: SkillTreeNode[];
  editingSkill?: SkillTreeNode | null;
  onSave: (skill: Omit<CustomSkill, "isCustom" | "createdAt">) => Promise<void>;
  saving: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function CustomSkillDialog({
  open,
  onOpenChange,
  allSkills,
  editingSkill,
  onSave,
  saving,
  t,
}: CustomSkillDialogProps) {
  const isEditing = !!editingSkill;
  const [form, setForm] = useState<FormData>(
    editingSkill ? skillToForm(editingSkill) : EMPTY_FORM
  );
  const [depSearch, setDepSearch] = useState("");

  // Reset form when dialog opens
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setForm(editingSkill ? skillToForm(editingSkill) : EMPTY_FORM);
        setDepSearch("");
      }
      onOpenChange(nextOpen);
    },
    [editingSkill, onOpenChange]
  );

  const updateField = useCallback(
    <K extends keyof FormData>(key: K, value: FormData[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const toggleDep = useCallback((skillId: string) => {
    setForm((prev) => {
      const has = prev.dependencies.includes(skillId);
      return {
        ...prev,
        dependencies: has
          ? prev.dependencies.filter((d) => d !== skillId)
          : [...prev.dependencies, skillId],
      };
    });
  }, []);

  const removeDep = useCallback((skillId: string) => {
    setForm((prev) => ({
      ...prev,
      dependencies: prev.dependencies.filter((d) => d !== skillId),
    }));
  }, []);

  const filteredDeps = useMemo(() => {
    const q = depSearch.toLowerCase();
    return allSkills.filter(
      (s) =>
        s.id !== editingSkill?.id &&
        (s.name.toLowerCase().includes(q) || s.nameZh.includes(q))
    );
  }, [allSkills, depSearch, editingSkill]);

  const isValid =
    form.name.trim().length > 0 && form.description.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    await onSave(formToSkill(form, editingSkill?.id));
  }, [form, isValid, onSave, editingSkill]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("custom.editSkill") : t("custom.createSkill")}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("custom.editSkill")
              : t("custom.addSkill")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.name")} *
              </label>
              <Input
                className="h-8 text-xs"
                placeholder={t("custom.form.namePlaceholder")}
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.nameZh")}
              </label>
              <Input
                className="h-8 text-xs"
                placeholder={t("custom.form.nameZhPlaceholder")}
                value={form.nameZh}
                onChange={(e) => updateField("nameZh", e.target.value)}
              />
            </div>
          </div>

          {/* Description */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.description")} *
              </label>
              <Input
                className="h-8 text-xs"
                placeholder={t("custom.form.descPlaceholder")}
                value={form.description}
                onChange={(e) => updateField("description", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.descriptionZh")}
              </label>
              <Input
                className="h-8 text-xs"
                placeholder={t("custom.form.descZhPlaceholder")}
                value={form.descriptionZh}
                onChange={(e) => updateField("descriptionZh", e.target.value)}
              />
            </div>
          </div>

          {/* Category + Tier */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.category")}
              </label>
              <Select
                value={form.category}
                onValueChange={(v) => updateField("category", v as SkillCategory)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("custom.form.selectCategory")} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span style={{ color: cat.glowColor }}>{cat.name}</span>
                      <span className="text-muted-foreground ml-1 text-[10px]">
                        ({cat.nameZh})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.tier")}
              </label>
              <Select
                value={String(form.tier)}
                onValueChange={(v) => updateField("tier", parseInt(v))}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((tier) => (
                    <SelectItem key={tier} value={String(tier)}>
                      T{tier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ImplType + Icon */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.implType")}
              </label>
              <Select
                value={form.implType}
                onValueChange={(v) => updateField("implType", v as ImplType)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t("custom.form.selectImplType")} />
                </SelectTrigger>
                <SelectContent>
                  {IMPL_TYPES.map((it) => (
                    <SelectItem key={it.value} value={it.value}>
                      {t(`implType.${it.key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                {t("custom.form.icon")}
              </label>
              <Input
                className="h-8 text-xs"
                placeholder="Puzzle"
                value={form.icon}
                onChange={(e) => updateField("icon", e.target.value)}
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1">
            <label className="text-xs font-medium">
              {t("custom.form.tags")}
            </label>
            <Input
              className="h-8 text-xs"
              placeholder={t("custom.form.tagsPlaceholder")}
              value={form.tags}
              onChange={(e) => updateField("tags", e.target.value)}
            />
          </div>

          {/* Dependencies */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              {t("custom.form.dependencies")}
            </label>
            {form.dependencies.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {form.dependencies.map((depId) => {
                  const dep = allSkills.find((s) => s.id === depId);
                  return (
                    <Badge
                      key={depId}
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 gap-1"
                    >
                      {dep?.name ?? depId}
                      <button
                        onClick={() => removeDep(depId)}
                        className="hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
            <Input
              className="h-7 text-xs"
              placeholder={t("custom.form.selectDeps")}
              value={depSearch}
              onChange={(e) => setDepSearch(e.target.value)}
            />
            {depSearch && (
              <div className="max-h-28 overflow-y-auto border rounded-md p-1 space-y-0.5">
                {filteredDeps.slice(0, 15).map((s) => (
                  <button
                    key={s.id}
                    className={`w-full text-left text-[10px] px-2 py-1 rounded hover:bg-accent transition-colors ${
                      form.dependencies.includes(s.id)
                        ? "bg-primary/10 font-medium"
                        : ""
                    }`}
                    onClick={() => toggleDep(s.id)}
                  >
                    {s.name}{" "}
                    <span className="text-muted-foreground">({s.nameZh})</span>
                  </button>
                ))}
                {filteredDeps.length === 0 && (
                  <div className="text-[10px] text-muted-foreground px-2 py-1">
                    No matching skills
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            {t("custom.form.name").includes("Name") ? "Cancel" : "取消"}
          </Button>
          <Button
            size="sm"
            disabled={!isValid || saving}
            onClick={handleSubmit}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEditing
              ? saving
                ? "..."
                : t("custom.editSkill")
              : saving
                ? "..."
                : t("custom.addSkill")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
