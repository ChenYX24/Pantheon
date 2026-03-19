"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InfoNeed } from "../types";
import { NeedCard, type EditForm } from "./need-card";

interface NeedsManagerProps {
  open: boolean;
  onClose: () => void;
  needs: InfoNeed[];
  onNeedsChange: () => void;
  isZh: boolean;
}

export function NeedsManager({
  open,
  onClose,
  needs,
  onNeedsChange,
  isZh,
}: NeedsManagerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss delete confirmation after 3 seconds
  useEffect(() => {
    if (deleteConfirmId) {
      deleteTimerRef.current = setTimeout(() => {
        setDeleteConfirmId(null);
      }, 3000);
    }
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, [deleteConfirmId]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await fetch("/api/plugins/daily-briefing/needs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, enabled }),
        });
        onNeedsChange();
      } catch (err) {
        console.error("[NeedsManager] Toggle error:", err);
      }
    },
    [onNeedsChange],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await fetch("/api/plugins/daily-briefing/needs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        setDeleteConfirmId(null);
        onNeedsChange();
      } catch (err) {
        console.error("[NeedsManager] Delete error:", err);
      }
    },
    [onNeedsChange],
  );

  // --- Edit handlers ---

  const startEdit = useCallback((need: InfoNeed) => {
    setEditingId(need.id);
    setEditForm({
      name: need.name,
      description: need.description,
      tags: [...need.tags],
      keywords: [...need.strategy.keywords],
    });
    setExpandedId(need.id);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditForm(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editingId || !editForm) return;
    try {
      await fetch("/api/plugins/daily-briefing/needs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: editForm.name,
          description: editForm.description,
          tags: editForm.tags,
          strategy: { keywords: editForm.keywords },
        }),
      });
      onNeedsChange();
      setEditingId(null);
      setEditForm(null);
    } catch (err) {
      console.error("[NeedsManager] Save error:", err);
    }
  }, [editingId, editForm, onNeedsChange]);

  const updateField = useCallback(
    (field: keyof EditForm, value: string | string[]) => {
      setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
    },
    [],
  );

  const removeChip = useCallback(
    (field: "tags" | "keywords", index: number) => {
      setEditForm((prev) => {
        if (!prev) return prev;
        return { ...prev, [field]: prev[field].filter((_, i) => i !== index) };
      });
    },
    [],
  );

  const addChip = useCallback(
    (field: "tags" | "keywords", value: string) => {
      setEditForm((prev) => {
        if (!prev || prev[field].includes(value)) return prev;
        return { ...prev, [field]: [...prev[field], value] };
      });
    },
    [],
  );

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-md z-50 bg-background border-l shadow-xl overflow-y-auto animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-background z-10">
          <h2 className="text-lg font-semibold">
            {isZh ? "我的信息需求" : "My Information Needs"}
          </h2>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Needs list */}
        <div className="p-6 space-y-3">
          {needs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-sm">
                {isZh
                  ? "还没有信息需求，点击「新需求」添加"
                  : "No needs yet. Click 'New Need' to add one."}
              </p>
            </div>
          ) : (
            needs.map((need) => (
              <NeedCard
                key={need.id}
                need={need}
                isExpanded={expandedId === need.id}
                editing={editingId === need.id}
                editForm={editingId === need.id ? editForm : null}
                deleteConfirming={deleteConfirmId === need.id}
                isZh={isZh}
                onToggleExpand={() => toggleExpand(need.id)}
                onToggleEnabled={(v) => handleToggle(need.id, v)}
                onStartEdit={() => startEdit(need)}
                onCancelEdit={cancelEdit}
                onSave={handleSave}
                onUpdateField={updateField}
                onRemoveChip={removeChip}
                onAddChip={addChip}
                onDeleteClick={() => setDeleteConfirmId(need.id)}
                onDeleteConfirm={() => handleDelete(need.id)}
                onDeleteCancel={() => setDeleteConfirmId(null)}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
