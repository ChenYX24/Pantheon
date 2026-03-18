"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";

interface DeleteSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skillName: string;
  onConfirm: () => Promise<void>;
  deleting: boolean;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export function DeleteSkillDialog({
  open,
  onOpenChange,
  skillName,
  onConfirm,
  deleting,
  t,
}: DeleteSkillDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            {t("custom.deleteSkill")}
          </DialogTitle>
          <DialogDescription>
            {t("custom.deleteConfirm", { name: skillName })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {t("smart.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={deleting}
            className="gap-1.5"
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("custom.deleteSkill")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
