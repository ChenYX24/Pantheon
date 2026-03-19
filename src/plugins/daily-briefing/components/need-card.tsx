"use client";

import { X, Trash2, Edit2, Check, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { InfoNeed } from "../types";

interface EditForm {
  name: string;
  description: string;
  tags: string[];
  keywords: string[];
}

interface NeedCardProps {
  need: InfoNeed;
  isExpanded: boolean;
  editing: boolean;
  editForm: EditForm | null;
  deleteConfirming: boolean;
  isZh: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onUpdateField: (field: keyof EditForm, value: string | string[]) => void;
  onRemoveChip: (field: "tags" | "keywords", index: number) => void;
  onAddChip: (field: "tags" | "keywords", value: string) => void;
  onDeleteClick: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

export function NeedCard({
  need, isExpanded, editing, editForm, deleteConfirming, isZh,
  onToggleExpand, onToggleEnabled, onStartEdit, onCancelEdit, onSave,
  onUpdateField, onRemoveChip, onAddChip,
  onDeleteClick, onDeleteConfirm, onDeleteCancel,
}: NeedCardProps) {
  return (
    <div className={`rounded-lg border p-4 space-y-2 ${editing ? "ring-1 ring-primary/40" : ""}`}>
      {/* Header: name/description + toggle */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {editing && editForm ? (
            <div className="space-y-2">
              <Input
                className="h-7 text-sm font-medium"
                value={editForm.name}
                onChange={(e) => onUpdateField("name", e.target.value)}
                placeholder={isZh ? "需求名称" : "Need name"}
              />
              <Textarea
                className="text-xs min-h-[48px] resize-none"
                rows={2}
                value={editForm.description}
                onChange={(e) => onUpdateField("description", e.target.value)}
                placeholder={isZh ? "描述" : "Description"}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{need.name}</span>
                {need.tags.slice(0, 2).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] px-1 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {need.description}
              </p>
            </>
          )}
        </div>
        {!editing && (
          <Switch checked={need.enabled} onCheckedChange={onToggleEnabled} />
        )}
      </div>

      {/* Tags editor (edit mode only) */}
      {editing && editForm && (
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">{isZh ? "标签" : "Tags"}</span>
          <ChipEditor
            items={editForm.tags}
            onRemove={(i) => onRemoveChip("tags", i)}
            onAdd={(v) => onAddChip("tags", v)}
            placeholder={isZh ? "+ 标签" : "+ tag"}
          />
        </div>
      )}

      {/* Last fetched (view mode only) */}
      {!editing && need.lastFetchedAt && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {isZh ? "上次抓取" : "Last fetched"}: {new Date(need.lastFetchedAt).toLocaleString()}
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-1">
        {editing ? (
          <>
            <Button variant="default" size="sm" className="h-7 text-xs" onClick={onSave} disabled={!editForm?.name.trim()}>
              <Check className="h-3 w-3 mr-1" />{isZh ? "保存" : "Save"}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancelEdit}>
              {isZh ? "取消" : "Cancel"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggleExpand}>
              {isExpanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              {isZh ? "策略详情" : "Strategy"}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={onStartEdit}>
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            {deleteConfirming ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-destructive font-medium">{isZh ? "确认删除?" : "Delete?"}</span>
                <Button variant="destructive" size="sm" className="h-6 text-xs px-2" onClick={onDeleteConfirm}>
                  {isZh ? "确认" : "Confirm"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onDeleteCancel}>
                  {isZh ? "取消" : "Cancel"}
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={onDeleteClick}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}
      </div>

      {/* Strategy details (expanded) */}
      {isExpanded && (
        <div className="rounded-md bg-muted/30 p-3 space-y-2 text-xs">
          {editing && editForm ? (
            <div className="space-y-1">
              <span className="text-muted-foreground">{isZh ? "关键词" : "Keywords"}</span>
              <ChipEditor
                items={editForm.keywords}
                onRemove={(i) => onRemoveChip("keywords", i)}
                onAdd={(v) => onAddChip("keywords", v)}
                placeholder={isZh ? "+ 关键词" : "+ keyword"}
              />
            </div>
          ) : (
            <div>
              <span className="text-muted-foreground">{isZh ? "关键词" : "Keywords"}:</span>{" "}
              {need.strategy.keywords.join(", ")}
            </div>
          )}
          <div>
            <span className="text-muted-foreground">{isZh ? "来源" : "Sources"}:</span>{" "}
            {need.strategy.sources.map((s) => `${s.name} (${s.type})`).join(", ")}
          </div>
          {need.strategy.filters.length > 0 && (
            <div>
              <span className="text-muted-foreground">{isZh ? "过滤" : "Filters"}:</span>{" "}
              {need.strategy.filters.map((f) => `${f.field} ${f.operator} "${f.value}"`).join("; ")}
            </div>
          )}
          <div>
            <span className="text-muted-foreground">{isZh ? "频率" : "Schedule"}:</span>{" "}
            {need.strategy.schedule}
          </div>
        </div>
      )}
    </div>
  );
}

/** Reusable chip editor for tags and keywords */
function ChipEditor({
  items, onRemove, onAdd, placeholder,
}: {
  items: string[];
  onRemove: (index: number) => void;
  onAdd: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {items.map((item, i) => (
        <Badge
          key={`${item}-${i}`}
          variant="secondary"
          className="text-xs gap-1 cursor-pointer hover:bg-destructive/20"
          onClick={() => onRemove(i)}
        >
          {item}
          <X className="h-2.5 w-2.5" />
        </Badge>
      ))}
      <Input
        className="h-6 w-24 text-xs"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const val = e.currentTarget.value.trim();
            if (val) {
              onAdd(val);
              e.currentTarget.value = "";
            }
            e.preventDefault();
          }
        }}
      />
    </div>
  );
}

export type { EditForm };
