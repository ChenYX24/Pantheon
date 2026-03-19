"use client";

import { memo, useState, useCallback, useMemo } from "react";
import {
  RefreshCw,
  Trash2,
  Edit3,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Wallet,
  Cpu,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { ModelDetailPanel } from "./ModelDetailPanel";
import {
  type ApiKeyRecord,
  type CheckResult,
  getProviderColor,
  formatDate,
  formatCurrency,
} from "./types";

export const ApiKeyCard = memo(function ApiKeyCard({
  keyRecord,
  onCheck,
  onEdit,
  onDelete,
  checkResult,
  isChecking,
}: {
  keyRecord: ApiKeyRecord;
  onCheck: () => void;
  onEdit: () => void;
  onDelete: () => void;
  checkResult?: CheckResult;
  isChecking: boolean;
}) {
  const t = useTranslations("apiManagement");
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [copyError, setCopyError] = useState<string | null>(null);

  const handleCopyKey = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setCopyError(null);
    try {
      const res = await fetch(`/api/plugins/api-management/keys/reveal?id=${keyRecord.id}`);
      const data = await res.json();
      if (data.corrupted) {
        setCopyError(data.error || "Key corrupted — please delete and re-enter.");
        return;
      }
      if (data.key) {
        await navigator.clipboard.writeText(data.key);
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1500);
      } else if (data.error) {
        setCopyError(data.error);
      }
    } catch { /* ignore */ }
  }, [keyRecord.id]);

  const handleCopyUrl = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (keyRecord.base_url) {
      navigator.clipboard.writeText(keyRecord.base_url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }
  }, [keyRecord.base_url]);

  const statusDot = useMemo(() => {
    if (!keyRecord.is_active) return "bg-gray-400";
    if (isChecking) return "bg-yellow-400 animate-pulse";
    if (!checkResult) return "bg-gray-400";
    if (checkResult.valid) return "bg-green-500";
    return "bg-red-500";
  }, [keyRecord.is_active, isChecking, checkResult]);

  const statusText = useMemo(() => {
    if (!keyRecord.is_active) return t("keyStatus.disabled");
    if (isChecking) return t("keyStatus.checking");
    if (!checkResult) return t("keyStatus.notChecked");
    if (checkResult.valid) return t("keyStatus.valid");
    return checkResult.error || t("keyStatus.invalid");
  }, [keyRecord.is_active, isChecking, checkResult, t]);

  const handleCardClick = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const neverLabel = t("detail.never");

  return (
    <div className="rounded-lg border bg-card transition-all">
      {/* Card Header -- clickable to expand */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/30 transition-colors rounded-t-lg"
        onClick={handleCardClick}
      >
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot}`} />
        <Badge className={`${getProviderColor(keyRecord.provider)} border-0 text-[10px]`}>
          {keyRecord.provider}
        </Badge>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{keyRecord.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <button
              onClick={handleCopyKey}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group"
              title={t("tooltip.copyKey")}
            >
              <code className="text-xs font-mono group-hover:text-foreground">{keyRecord.key_masked}</code>
              {copiedKey ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
            </button>
            {keyRecord.base_url && (
              <button
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group"
                title={t("tooltip.copyUrl")}
              >
                <code className="text-[10px] font-mono bg-muted px-1 rounded group-hover:text-foreground">{keyRecord.base_url}</code>
                {copiedUrl ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>

        {/* Quick stats inline */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
          {checkResult?.balance && (
            <span className="flex items-center gap-1">
              <Wallet className="h-3 w-3" />
              {formatCurrency(checkResult.balance.amount, checkResult.balance.currency)}
            </span>
          )}
          {checkResult?.usage && checkResult.usage.used > 0 && (
            <span className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              ${checkResult.usage.used.toFixed(2)}
            </span>
          )}
          {checkResult?.models && checkResult.models.length > 0 && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {checkResult.models.length}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5" onClick={stopPropagation}>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCheck} disabled={isChecking} title={t("tooltip.checkStatus")}>
            {isChecking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
<Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit} title={t("tooltip.edit")}>
            <Edit3 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} title={t("tooltip.delete")}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Expand indicator */}
        <div className="text-muted-foreground">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </div>

      {/* Mobile quick info row */}
      <div className="flex sm:hidden items-center gap-3 px-4 pb-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {checkResult?.valid ? <CheckCircle className="h-3 w-3 text-green-500" /> : checkResult && !checkResult.valid ? <XCircle className="h-3 w-3 text-red-500" /> : <AlertCircle className="h-3 w-3" />}
          {statusText}
        </span>
        {checkResult?.balance && (
          <span className="flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            {formatCurrency(checkResult.balance.amount, checkResult.balance.currency)}
          </span>
        )}
        {checkResult?.models && checkResult.models.length > 0 && (
          <span className="flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            {checkResult.models.length} {t("detail.models")}
          </span>
        )}
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t px-4 py-4 space-y-4">
          {/* Top section: Balance + Usage + Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Balance */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t("detail.balance")}</div>
              {checkResult?.balance ? (
                <div className="text-2xl font-bold">
                  {formatCurrency(checkResult.balance.amount, checkResult.balance.currency)}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">{t("charts.notAvailable")}</div>
              )}
            </div>

            {/* Usage */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t("charts.usage")}</div>
              {checkResult?.usage && checkResult.usage.used > 0 ? (
                <div>
                  <div className="text-2xl font-bold">${checkResult.usage.used.toFixed(2)}</div>
                  {checkResult.usage.limit > 0 && (
                    <div className="mt-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                        <span>{t("charts.used")}</span>
                        <span>{t("charts.limit")}: ${checkResult.usage.limit.toFixed(0)}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (checkResult.usage.used / checkResult.usage.limit) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">{t("charts.notAvailable")}</div>
              )}
            </div>

            {/* Meta */}
            <div className="space-y-1.5 text-xs">
              <div className="text-xs font-medium text-muted-foreground">{t("charts.details")}</div>
              <div>
                <span className="text-muted-foreground">{t("charts.status")}: </span>
                <span className={checkResult?.valid ? "text-green-600" : "text-muted-foreground"}>{statusText}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t("detail.created")} </span>
                {formatDate(keyRecord.created_at, neverLabel)}
              </div>
              <div>
                <span className="text-muted-foreground">{t("charts.lastUsed")}: </span>
                {formatDate(keyRecord.last_used_at, neverLabel)}
              </div>
              <div>
                <span className="text-muted-foreground">{t("detail.uses")} </span>
                {keyRecord.usage_count}
              </div>
              {keyRecord.base_url && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">{t("detail.baseUrl")} </span>
                  <code className="bg-muted px-1 rounded text-[10px]">{keyRecord.base_url}</code>
                  <button onClick={handleCopyUrl} className="text-muted-foreground hover:text-foreground transition-colors" title={t("tooltip.copyUrl")}>
                    {copiedUrl ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              )}
              {keyRecord.notes && (
                <div className="text-muted-foreground bg-muted rounded p-1.5 mt-1">
                  {keyRecord.notes}
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {(checkResult?.error || copyError) && (
            <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
              {copyError || checkResult?.error}
            </div>
          )}

          {/* Models Panel */}
          {checkResult?.models && checkResult.models.length > 0 && (
            <div className="border-t pt-3">
              <ModelDetailPanel models={checkResult.models} keyName={keyRecord.name} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
