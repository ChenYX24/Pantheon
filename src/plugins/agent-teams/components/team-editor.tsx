"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import {
  Plus, Trash2, ChevronDown, ChevronUp, GripVertical,
  Loader2, Save, Users,
} from "lucide-react";
import type { AgentTeam, TeamMember, WorkflowMode, MemberProvider, ApiKeyOption } from "../types";
import { ALL_MODELS } from "../team-data";

function generateMemberId(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Member Editor Row ----

function MemberEditor({
  member,
  apiKeys,
  onUpdate,
  onRemove,
  isOnly,
  nameError,
  promptError,
}: {
  member: TeamMember;
  apiKeys: ApiKeyOption[];
  onUpdate: (updates: Partial<TeamMember>) => void;
  onRemove: () => void;
  isOnly: boolean;
  /** Inline validation error for the name field */
  nameError?: string;
  /** Inline validation error for the systemPrompt field */
  promptError?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const providerModels = useMemo(() => {
    const groups: Record<string, typeof ALL_MODELS> = {};
    for (const m of ALL_MODELS) {
      if (!groups[m.group]) groups[m.group] = [];
      groups[m.group].push(m);
    }
    return groups;
  }, []);

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-card">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 cursor-grab" />
        <div className="flex-1 min-w-0">
          <Input
            value={member.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className={`h-8 text-sm font-medium ${nameError ? "border-destructive" : ""}`}
            placeholder="Member name"
          />
          {nameError && (
            <p className="text-[10px] text-destructive mt-0.5">{nameError}</p>
          )}
        </div>
        <Select value={member.provider} onValueChange={(v) => onUpdate({ provider: v as MemberProvider })}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="api">API</SelectItem>
          </SelectContent>
        </Select>
        <Select value={member.model} onValueChange={(v) => onUpdate({ model: v })}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(providerModels).map(([group, models]) => (
              <div key={group}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group}
                </div>
                {models.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive"
          onClick={onRemove}
          disabled={isOnly}
          title="Remove member"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2 pt-1 border-t">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Role</label>
              <Input
                value={member.role}
                onChange={(e) => onUpdate({ role: e.target.value })}
                className="h-8 text-xs"
                placeholder="e.g. Code Reviewer"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Tier (1=top)</label>
              <Select value={String(member.tier)} onValueChange={(v) => onUpdate({ tier: Number(v) })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((t) => (
                    <SelectItem key={t} value={String(t)}>Tier {t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* API Key (for api/codex provider) */}
          {(member.provider === "api" || member.provider === "codex") && apiKeys.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-medium">API Key</label>
              <Select value={member.apiKeyId || "none"} onValueChange={(v) => onUpdate({ apiKeyId: v === "none" ? undefined : v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Use env variable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Use env variable</SelectItem>
                  {apiKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      <span className="flex items-center gap-1">
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">{k.provider}</Badge>
                        {k.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium">Description</label>
            <Input
              value={member.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              className="h-8 text-xs"
              placeholder="What this member does"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">System Prompt</label>
            <textarea
              value={member.systemPrompt}
              onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
              className={`w-full text-xs border rounded-md p-2 bg-background min-h-[80px] focus:outline-none focus:ring-1 focus:ring-ring resize-y ${promptError ? "border-destructive" : ""}`}
              placeholder="Instructions for this agent..."
            />
            {promptError && (
              <p className="text-[10px] text-destructive">{promptError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main Team Editor Dialog ----

interface TeamEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  team: AgentTeam | null;
  onSave: (team: Omit<AgentTeam, "id" | "created_at" | "updated_at">) => void;
  saving?: boolean;
}

export function TeamEditor({ open, onOpenChange, team, onSave, saving }: TeamEditorProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("users");
  const [workflow, setWorkflow] = useState<WorkflowMode>("sequential");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [tags, setTags] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyOption[]>([]);

  // Load API keys
  useEffect(() => {
    if (!open) return;
    fetch("/api/plugins/api-management/keys")
      .then((r) => r.json())
      .then((data) => {
        if (data.keys) {
          setApiKeys(
            data.keys
              .filter((k: ApiKeyOption & { is_active: number }) => k.is_active)
              .map((k: ApiKeyOption & { is_active: number }) => ({
                id: k.id,
                name: k.name,
                provider: k.provider,
                key_masked: k.key_masked,
              }))
          );
        }
      })
      .catch((err) => {
        console.error("[TeamEditor] Failed to load API keys:", err);
      });
  }, [open]);

  // Reset form when team changes
  useEffect(() => {
    if (!open) return;
    if (team) {
      setName(team.name);
      setDescription(team.description);
      setIcon(team.icon);
      setWorkflow(team.workflow);
      setMembers(team.members.map((m) => ({ ...m })));
      setTags(team.tags.join(", "));
    } else {
      setName("");
      setDescription("");
      setIcon("users");
      setWorkflow("sequential");
      setMembers([{
        id: generateMemberId(),
        name: "Agent 1",
        role: "",
        description: "",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "",
        order: 1,
        tier: 1,
      }]);
      setTags("");
    }
  }, [open, team]);

  const handleAddMember = useCallback(() => {
    const maxOrder = members.reduce((max, m) => Math.max(max, m.order), 0);
    setMembers((prev) => [
      ...prev,
      {
        id: generateMemberId(),
        name: `Agent ${prev.length + 1}`,
        role: "",
        description: "",
        provider: "claude",
        model: "claude-sonnet-4-6",
        systemPrompt: "",
        order: maxOrder + 1,
        tier: 1,
      },
    ]);
  }, [members]);

  const handleUpdateMember = useCallback((id: string, updates: Partial<TeamMember>) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updates } : m))
    );
  }, []);

  const handleRemoveMember = useCallback((id: string) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // ---- Validation ----
  const memberErrors = useMemo(() => {
    const errors: Record<string, { name?: string; prompt?: string }> = {};
    const nameCount: Record<string, number> = {};

    // Count name occurrences for duplicate detection
    for (const m of members) {
      const trimmed = m.name.trim().toLowerCase();
      if (trimmed) {
        nameCount[trimmed] = (nameCount[trimmed] ?? 0) + 1;
      }
    }

    for (const m of members) {
      const e: { name?: string; prompt?: string } = {};
      if (!m.name.trim()) {
        e.name = "Name is required";
      } else if (nameCount[m.name.trim().toLowerCase()] > 1) {
        e.name = "Duplicate member name";
      }
      if (!m.systemPrompt.trim()) {
        e.prompt = "System prompt is required";
      }
      if (e.name || e.prompt) {
        errors[m.id] = e;
      }
    }
    return errors;
  }, [members]);

  const hasMemberErrors = Object.keys(memberErrors).length > 0;

  const handleSubmit = () => {
    if (hasMemberErrors) return;
    onSave({
      name,
      description,
      icon,
      workflow,
      members,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      isPreset: false,
    });
  };

  const isValid = name.trim() && members.length > 0 && !hasMemberErrors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {team ? "Edit Team" : "Create Team"}
          </DialogTitle>
          <DialogDescription>
            Configure your agent team with different models and providers for each member.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Team basics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Team Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My TDD Squad"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Workflow</label>
              <Select value={workflow} onValueChange={(v) => setWorkflow(v as WorkflowMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential (one after another)</SelectItem>
                  <SelectItem value="parallel">Parallel (all at once)</SelectItem>
                  <SelectItem value="hierarchical">Hierarchical (tiered)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Icon</label>
              <Select value={icon} onValueChange={setIcon}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="users">Users</SelectItem>
                  <SelectItem value="castle">Castle (Governance)</SelectItem>
                  <SelectItem value="flask-conical">Flask (Testing)</SelectItem>
                  <SelectItem value="layers">Layers (Full Stack)</SelectItem>
                  <SelectItem value="brain">Brain (Research)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tags</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma-separated tags"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this team do?"
            />
          </div>

          {/* Members */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Members ({members.length})</label>
              <Button variant="outline" size="sm" onClick={handleAddMember} className="h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" />
                Add Member
              </Button>
            </div>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {members.map((member) => (
                <MemberEditor
                  key={member.id}
                  member={member}
                  apiKeys={apiKeys}
                  onUpdate={(updates) => handleUpdateMember(member.id, updates)}
                  onRemove={() => handleRemoveMember(member.id)}
                  isOnly={members.length <= 1}
                  nameError={memberErrors[member.id]?.name}
                  promptError={memberErrors[member.id]?.prompt}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!isValid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {team ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
