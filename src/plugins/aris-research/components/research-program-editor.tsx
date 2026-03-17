"use client";

import { useState, useCallback, useRef, type DragEvent, type ClipboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  LinkIcon,
  ImageIcon,
  X,
  Upload,
  Eye,
  Edit3,
} from "lucide-react";
import type { ResearchProgram, ProgramAttachment } from "../types";

interface ResearchProgramEditorProps {
  program: ResearchProgram;
  onChange: (program: ResearchProgram) => void;
  isZh: boolean;
}

function generateId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const ACCEPT_FILE_TYPES = ".jsonl,.pdf,.csv,.py,.json,.txt,.md,.bib,.tex,.yaml,.yml";

export function ResearchProgramEditor({ program, onChange, isZh }: ResearchProgramEditorProps) {
  const [open, setOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateBrief = useCallback(
    (brief: string) => onChange({ ...program, brief }),
    [program, onChange]
  );

  const addAttachment = useCallback(
    (att: ProgramAttachment) =>
      onChange({ ...program, attachments: [...program.attachments, att] }),
    [program, onChange]
  );

  const removeAttachment = useCallback(
    (id: string) =>
      onChange({
        ...program,
        attachments: program.attachments.filter((a) => a.id !== id),
      }),
    [program, onChange]
  );

  // File drop handler
  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const url = URL.createObjectURL(file);
        addAttachment({
          id: generateId(),
          name: file.name,
          type: file.type.startsWith("image/") ? "image" : "file",
          url,
          mimeType: file.type,
          addedAt: new Date().toISOString(),
        });
      }
    },
    [addAttachment]
  );

  // File picker
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      for (const file of files) {
        const url = URL.createObjectURL(file);
        addAttachment({
          id: generateId(),
          name: file.name,
          type: file.type.startsWith("image/") ? "image" : "file",
          url,
          mimeType: file.type,
          addedAt: new Date().toISOString(),
        });
      }
    },
    [addAttachment]
  );

  // Image paste
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          addAttachment({
            id: generateId(),
            name: `pasted-image-${Date.now()}.png`,
            type: "image",
            url,
            mimeType: item.type,
            addedAt: new Date().toISOString(),
          });
        }
      }
    },
    [addAttachment]
  );

  // Link add
  const handleAddLink = useCallback(() => {
    const url = linkInput.trim();
    if (!url) return;
    addAttachment({
      id: generateId(),
      name: url.replace(/^https?:\/\//, "").slice(0, 60),
      type: "link",
      url,
      addedAt: new Date().toISOString(),
    });
    setLinkInput("");
  }, [linkInput, addAttachment]);

  const fileAtts = program.attachments.filter((a) => a.type === "file");
  const linkAtts = program.attachments.filter((a) => a.type === "link");
  const imageAtts = program.attachments.filter((a) => a.type === "image");

  return (
    <div className="border-t bg-background">
      {/* Toggle header */}
      <button
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-accent/50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {isZh ? "研究纲要 (Research Program)" : "Research Program"}
          {program.attachments.length > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">
              {program.attachments.length}
            </Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Brief editor */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                {isZh ? "研究方向 & 上下文" : "Research brief & context"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => setPreview((v) => !v)}
              >
                {preview ? <Edit3 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {preview ? (isZh ? "编辑" : "Edit") : (isZh ? "预览" : "Preview")}
              </Button>
            </div>

            {preview ? (
              <div className="border rounded-md p-3 text-xs prose prose-sm dark:prose-invert max-w-none min-h-[120px] whitespace-pre-wrap">
                {program.brief || (isZh ? "（空）" : "(empty)")}
              </div>
            ) : (
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y min-h-[120px]"
                value={program.brief}
                onChange={(e) => updateBrief(e.target.value)}
                onPaste={handlePaste}
                placeholder={
                  isZh
                    ? "描述你的研究方向、背景、假设、关键问题...\n支持 Markdown 格式\n可以直接粘贴图片"
                    : "Describe your research direction, background, hypothesis...\nMarkdown supported\nPaste images directly"
                }
              />
            )}
          </div>

          {/* File drop zone */}
          <div
            className={`
              border-2 border-dashed rounded-md p-3 text-center transition-colors cursor-pointer
              ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/20 hover:border-muted-foreground/40"}
            `}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
            <p className="text-[11px] text-muted-foreground">
              {isZh
                ? "拖拽文件到这里（PDF, JSONL, CSV, Python...）"
                : "Drop files here (PDF, JSONL, CSV, Python...)"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept={ACCEPT_FILE_TYPES}
              onChange={handleFileSelect}
            />
          </div>

          {/* Link input */}
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                className="h-7 text-xs pl-7"
                placeholder={isZh ? "添加链接 (arXiv, GitHub...)" : "Add link (arXiv, GitHub...)"}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
              />
            </div>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleAddLink}>
              +
            </Button>
          </div>

          {/* Attachment chips */}
          {program.attachments.length > 0 && (
            <div className="space-y-2">
              {/* Files */}
              {fileAtts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {fileAtts.map((att) => (
                    <Badge key={att.id} variant="secondary" className="text-[10px] px-1.5 py-0.5 gap-1">
                      <FileText className="h-2.5 w-2.5" />
                      {att.name}
                      <button onClick={() => removeAttachment(att.id)} className="hover:text-red-500">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Links */}
              {linkAtts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {linkAtts.map((att) => (
                    <Badge key={att.id} variant="outline" className="text-[10px] px-1.5 py-0.5 gap-1">
                      <LinkIcon className="h-2.5 w-2.5" />
                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="hover:underline max-w-[200px] truncate">
                        {att.name}
                      </a>
                      <button onClick={() => removeAttachment(att.id)} className="hover:text-red-500">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Images */}
              {imageAtts.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {imageAtts.map((att) => (
                    <div key={att.id} className="relative group">
                      <img src={att.url} alt={att.name} className="h-16 w-16 object-cover rounded border" />
                      <button
                        className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full h-4 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => removeAttachment(att.id)}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
