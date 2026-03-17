"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { LiveChatMessage, PermissionMode } from "@/lib/chat-types";
import type { SessionInfo, SessionDetail } from "@/components/sessions/types";
import { shortModel, fmtTokens, fmtCost } from "@/lib/format-utils";
import {
  mergeAllCommands, LOCAL_COMMAND_NAMES, loadToolboxCommands,
} from "@/lib/chat-commands";
import type { ChatCommand } from "@/lib/chat-commands";

const DEFAULT_CWD = "E:\\claude-projects";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslateFn = (key: string, values?: any) => string;

export function useChatPage(t: TranslateFn) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  // Session viewer state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string>("");
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [convSearch, setConvSearch] = useState("");
  const [convSearchMatch, setConvSearchMatch] = useState(0);

  // Live chat state
  const [chatInput, setChatInput] = useState("");
  const [chatMode, setChatMode] = useState<"session" | "chat">("chat");
  const [claudeSessionId, setClaudeSessionId] = useState<string>("");

  // CLI capabilities
  const [cliSlashCommands, setCliSlashCommands] = useState<{ name: string; description?: string }[]>([]);
  const [cliModel, setCliModel] = useState<string>("");

  // Workspace settings
  const [chatCwd, setChatCwd] = useState<string>(DEFAULT_CWD);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [chatProvider, setChatProvider] = useState<string>("claude");
  const [chatModel, setChatModel] = useState<string>("");
  const [compareMode, setCompareMode] = useState(false);
  const [compareRightProvider, setCompareRightProvider] = useState<string>("codex");

  // Available providers
  const [availableProviders, setAvailableProviders] = useState<Set<string> | null>(null);

  // UI state
  const [idCopied, setIdCopied] = useState(false);
  const [cmdMenuIndex, setCmdMenuIndex] = useState(0);
  const [cmdMenuDismissed, setCmdMenuDismissed] = useState(false);

  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const chatInputRef = useRef(chatInput);
  const manualClearRef = useRef(false);
  /** true when user is near the bottom (within 150px) — auto-scroll only if true */
  const isNearBottomRef = useRef(true);
  /** tracks whether this is the initial load (first session detail fetch) */
  const initialLoadRef = useRef(true);

  // Streaming hook
  const {
    messages: chatMessages, setMessages: setChatMessages,
    sending: chatSending, currentPhase, elapsedMs,
    send: chatSend, cancel: chatCancel, clearMessages,
  } = useChatStream({
    onSessionId: setClaudeSessionId,
    onModel: setCliModel,
    onSlashCommands: setCliSlashCommands,
  });

  // Toolbox commands
  const [toolboxCommands, setToolboxCommands] = useState<ChatCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadToolboxCommands(chatProvider).then((cmds) => {
      if (!cancelled) setToolboxCommands(cmds);
    });
    return () => { cancelled = true; };
  }, [chatProvider]);

  // Derived values
  const allCommands = useMemo(
    () => mergeAllCommands({ provider: chatProvider, cliSlashCommands, toolboxCommands }),
    [chatProvider, cliSlashCommands, toolboxCommands],
  );
  // Use deferred value for command menu to avoid blocking input on every keystroke
  const deferredChatInput = useDeferredValue(chatInput);
  const showCommandMenu = deferredChatInput.startsWith("/") && !chatSending && !cmdMenuDismissed;

  const visible = useMemo(() => {
    if (!sessionDetail) return [];
    return sessionDetail.messages.filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        (m.content.trim() || (m.toolUse && m.toolUse.length > 0) || m.thinkingContent)
    );
  }, [sessionDetail]);

  const convSearchLower = useMemo(() => convSearch.trim().toLowerCase(), [convSearch]);
  const matchedIndices = useMemo(() => {
    if (!convSearchLower) return [];
    return visible
      .map((m, i) => (m.content.toLowerCase().includes(convSearchLower) ? i : -1))
      .filter((i) => i !== -1);
  }, [visible, convSearchLower]);

  const isSessionActive = useMemo(() => {
    if (!selectedSessionKey) return false;
    const session = sessions.find((s) => `${s.project}|${s.id}` === selectedSessionKey);
    return session ? Date.now() - session.lastActive < 5 * 60 * 1000 : false;
  }, [selectedSessionKey, sessions]);

  const isViewingSession = chatMode === "session" && !!sessionDetail;

  const activeSessionId = useMemo(() => {
    if (claudeSessionId) return claudeSessionId;
    if (selectedSessionKey) {
      const parts = selectedSessionKey.split("|");
      return parts.length > 1 ? parts[1] : undefined;
    }
    return undefined;
  }, [claudeSessionId, selectedSessionKey]);

  const lastToolName = useMemo(() => {
    if (!chatMessages.length) return undefined;
    const last = chatMessages[chatMessages.length - 1];
    if (last?.role === "assistant" && last.toolCalls.length > 0) {
      return last.toolCalls[last.toolCalls.length - 1].name;
    }
    return undefined;
  }, [chatMessages]);

  // ---------- Effects ----------

  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data) => {
        if (data.providers) {
          const avail = new Set<string>(
            data.providers.filter((p: { available: boolean }) => p.available).map((p: { name: string }) => p.name)
          );
          setAvailableProviders(avail);
        }
      })
      .catch(() => {
        setAvailableProviders(new Set(["claude"]));
      });
  }, []);

  useEffect(() => {
    const savedCwd = localStorage.getItem("chat-cwd");
    const savedPermission = localStorage.getItem("chat-permission-mode") as PermissionMode | null;
    const savedProvider = localStorage.getItem("chat-provider");
    const savedCompareRight = localStorage.getItem("chat-compare-right");
    const savedModel = localStorage.getItem("chat-model");
    if (savedCwd) setChatCwd(savedCwd);
    if (savedPermission) setPermissionMode(savedPermission);
    if (savedProvider) setChatProvider(savedProvider);
    if (savedModel) setChatModel(savedModel);
    if (savedCompareRight) setCompareRightProvider(savedCompareRight);
  }, []);

  useEffect(() => {
    if (!availableProviders) return;
    if (!availableProviders.has(chatProvider)) {
      setChatProvider("claude");
      localStorage.setItem("chat-provider", "claude");
    }
  }, [availableProviders, chatProvider]);

  useEffect(() => {
    const sessionParam = searchParams.get("session");
    if (sessionParam && !selectedSessionKey && !manualClearRef.current) {
      setSelectedSessionKey(sessionParam);
      setChatMode("session");
    }
  }, [searchParams, selectedSessionKey]);

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch("/api/sessions");
        const data = await res.json();
        setSessions(data.recentSessions || []);
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
      } finally {
        setLoadingSessions(false);
      }
    };
    fetchSessions();
  }, []);

  useEffect(() => {
    if (!selectedSessionKey) return;
    setChatMode("session");
    setCompareMode(false);
    clearMessages();
    setClaudeSessionId("");
    initialLoadRef.current = true;

    const isCodexSession = selectedSessionKey.startsWith("__codex__|");
    const sessionProvider = isCodexSession && availableProviders?.has("codex") ? "codex" : "claude";
    setChatProvider(sessionProvider);
    localStorage.setItem("chat-provider", sessionProvider);

    const fetchDetail = async () => {
      setLoading(true);
      setConvSearch("");
      setConvSearchMatch(0);
      try {
        const [project, id] = selectedSessionKey.split("|");
        const res = await fetch(`/api/sessions/${encodeURIComponent(project)}/${id}`);
        if (res.ok) {
          const detail = await res.json();
          setSessionDetail(detail);
          lastMessageCountRef.current = detail.messages.length;
        } else {
          setSessionDetail(null);
        }
      } catch (err) {
        console.error("Failed to fetch session detail:", err);
        setSessionDetail(null);
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [selectedSessionKey, clearMessages]);

  useEffect(() => {
    if (!selectedSessionKey || !sessionDetail || !autoRefresh || chatMode !== "session") return;
    const session = sessions.find((s) => `${s.project}|${s.id}` === selectedSessionKey);
    if (!session) return;
    const isActive = Date.now() - session.lastActive < 5 * 60 * 1000;
    if (!isActive) return;

    const interval = setInterval(async () => {
      try {
        const [project, id] = selectedSessionKey.split("|");
        const res = await fetch(`/api/sessions/${encodeURIComponent(project)}/${id}`);
        if (res.ok) {
          const detail = await res.json();
          setSessionDetail(detail);
          if (detail.messages.length > lastMessageCountRef.current) {
            lastMessageCountRef.current = detail.messages.length;
            if (isNearBottomRef.current) {
              scrollToBottom();
            }
          }
        }
      } catch (err) {
        console.error("Auto-refresh failed:", err);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedSessionKey, sessionDetail, sessions, autoRefresh, chatMode]);

  useEffect(() => { chatInputRef.current = chatInput; }, [chatInput]);
  // Only reset command menu state when input prefix changes (not every keystroke)
  const inputPrefix = chatInput.startsWith("/") ? chatInput.split(/\s/)[0] : "";
  useEffect(() => { setCmdMenuIndex(0); setCmdMenuDismissed(false); }, [inputPrefix]);

  useEffect(() => {
    if (!chatContainerRef.current) return;
    if (initialLoadRef.current) {
      // First load — always scroll to bottom instantly
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      if (sessionDetail || chatMessages.length > 0) {
        initialLoadRef.current = false;
      }
    } else if (isNearBottomRef.current) {
      // Only auto-scroll if user is already near the bottom
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [sessionDetail, chatMessages]);

  // Debounced search scroll — only scrolls after user stops typing for 300ms
  const searchScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchScrollTimerRef.current) clearTimeout(searchScrollTimerRef.current);
    if (matchedIndices.length === 0 || convSearchMatch < 0 || convSearchMatch >= matchedIndices.length) return;
    searchScrollTimerRef.current = setTimeout(() => {
      const msgIdx = matchedIndices[convSearchMatch];
      const msg = visible[msgIdx];
      if (msg) {
        document.getElementById(`msg-${msg.uuid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 300);
    return () => {
      if (searchScrollTimerRef.current) clearTimeout(searchScrollTimerRef.current);
    };
  }, [convSearchMatch, matchedIndices, visible]);

  // ---------- Callbacks ----------

  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShowScrollButton(distanceFromBottom > 100);
    isNearBottomRef.current = distanceFromBottom < 150;
  }, []);

  const exportAsMarkdown = useCallback(() => {
    if (!sessionDetail) return;
    let md = `# Session: ${sessionDetail.projectName}\n`;
    md += `**Date:** ${sessionDetail.startTime} - ${sessionDetail.endTime}\n`;
    md += `**Model:** ${shortModel(sessionDetail.model)}\n`;
    md += `**Cost:** ${fmtCost(sessionDetail.estimatedCost)}\n`;
    md += `**Tokens:** ${fmtTokens(sessionDetail.totalInputTokens)} in / ${fmtTokens(sessionDetail.totalOutputTokens)} out\n\n---\n\n`;
    for (const msg of sessionDetail.messages) {
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      if (!msg.content.trim() && (!msg.toolUse || msg.toolUse.length === 0)) continue;
      md += `## ${msg.role === "user" ? "User" : "Claude"}\n`;
      if (msg.timestamp) md += `*${new Date(msg.timestamp).toLocaleTimeString()}*\n\n`;
      if (msg.content.trim()) md += msg.content.trim() + "\n\n";
      if (msg.toolUse && msg.toolUse.length > 0) {
        for (const tool of msg.toolUse) {
          md += `### Tool: ${tool.name}\n\`\`\`json\n${tool.input?.slice(0, 500)}\n\`\`\`\n\n`;
        }
      }
      md += `---\n\n`;
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${sessionDetail.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast(t("exportedMarkdown"));
  }, [sessionDetail, toast, t]);

  const executeBuiltinCommand = useCallback((name: string) => {
    const makeMsg = (content: string): LiveChatMessage => ({
      id: crypto.randomUUID(),
      role: "assistant",
      text: content,
      thinkingContent: "",
      toolCalls: [],
      timestamp: Date.now(),
      phase: "complete",
    });

    switch (name) {
      case "/help": {
        const lines = allCommands.map((c) => `\`${c.name}\` — ${c.description}`).join("\n");
        setChatMessages((prev) => [...prev, makeMsg(`**${t("availableCommands")}**\n\n${lines}`)]);
        break;
      }
      case "/clear":
        clearMessages();
        toast(t("conversationCleared"));
        break;
      case "/model": {
        const model = cliModel || t("unknownModel");
        setChatMessages((prev) => [...prev, makeMsg(`**${t("currentModel")}:** ${model}`)]);
        break;
      }
      case "/cost": {
        setChatMessages((prev) => {
          const total = prev.filter((m) => m.cost != null).reduce((s, m) => s + (m.cost ?? 0), 0);
          return [...prev, makeMsg(`**${t("sessionCost")}:** $${total.toFixed(4)}\n**${t("messages")}:** ${prev.length}`)];
        });
        break;
      }
    }
  }, [allCommands, cliModel, toast, setChatMessages, clearMessages, t]);

  const handleSend = useCallback(async (overrideMessage?: string) => {
    const text = (overrideMessage ?? chatInputRef.current).trim();
    if (!text || chatSending) return;
    setChatInput("");
    await chatSend(text, {
      sessionId: activeSessionId,
      cwd: chatCwd || undefined,
      permissionMode,
      provider: chatProvider,
      model: chatModel || undefined,
    });
  }, [chatSending, activeSessionId, chatSend, chatCwd, permissionMode, chatProvider, chatModel]);

  // Handle ?run= parameter (with optional config: permission, cwd, model)
  const runHandledRef = useRef(false);
  useEffect(() => {
    const runParam = searchParams.get("run");
    if (runParam && !runHandledRef.current) {
      runHandledRef.current = true;

      // Read launch config from URL params
      const permParam = searchParams.get("permission");
      const cwdParam = searchParams.get("cwd");
      const modelParam = searchParams.get("model");

      const resolvedPerm = (permParam && ["default", "trust", "acceptEdits", "readOnly", "plan"].includes(permParam))
        ? permParam as PermissionMode
        : "trust"; // default to trust for skill launches
      const resolvedCwd = cwdParam || chatCwd || undefined;
      const resolvedModel = modelParam || undefined;

      // Update UI state for display
      setPermissionMode(resolvedPerm);
      if (cwdParam) setChatCwd(cwdParam);
      if (modelParam) setChatModel(modelParam);

      setChatMode("chat");
      setSelectedSessionKey("");
      setSessionDetail(null);

      // Directly call chatSend with explicit config to avoid stale closure
      setTimeout(() => {
        setChatInput(runParam);
        chatSend(runParam, {
          cwd: resolvedCwd,
          permissionMode: resolvedPerm,
          provider: chatProvider,
          model: resolvedModel,
        });
      }, 200);
      router.replace("/chat", { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, router]);

  const handleCommandSelect = useCallback((cmd: ChatCommand) => {
    setChatInput("");
    setCmdMenuIndex(0);
    if (LOCAL_COMMAND_NAMES.includes(cmd.name)) {
      executeBuiltinCommand(cmd.name);
    } else {
      handleSend(cmd.name);
    }
  }, [executeBuiltinCommand, handleSend]);

  const startNewChat = useCallback(() => {
    manualClearRef.current = true;
    setSelectedSessionKey("");
    setSessionDetail(null);
    clearMessages();
    setChatMode("chat");
    setChatInput("");
    setClaudeSessionId("");
    router.replace("/chat", { scroll: false });
    setTimeout(() => {
      manualClearRef.current = false;
    }, 500);
  }, [clearMessages, router]);

  const handleCopyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }, []);

  const handleViewInSessions = useCallback(() => {
    const [, id] = selectedSessionKey.split("|");
    router.push(`/sessions?highlight=${encodeURIComponent(id)}`);
  }, [selectedSessionKey, router]);

  const handleCwdChange = useCallback((p: string) => {
    setChatCwd(p);
    localStorage.setItem("chat-cwd", p);
  }, []);

  const handlePermissionModeChange = useCallback((m: PermissionMode) => {
    setPermissionMode(m);
    localStorage.setItem("chat-permission-mode", m);
  }, []);

  const handleProviderChange = useCallback((p: string) => {
    setChatProvider(p);
    localStorage.setItem("chat-provider", p);
    setChatModel("");
  }, []);

  const handleModelChange = useCallback((m: string) => {
    setChatModel(m);
    localStorage.setItem("chat-model", m);
  }, []);

  const handleCompareModeChange = useCallback((enabled: boolean) => {
    if (enabled) {
      setChatProvider("claude");
      setCompareRightProvider("codex");
      localStorage.setItem("chat-provider", "claude");
      setChatMode("chat");
    }
    setCompareMode(enabled);
  }, []);

  return {
    // State
    sessions,
    selectedSessionKey,
    setSelectedSessionKey,
    sessionDetail,
    loading,
    loadingSessions,
    autoRefresh,
    setAutoRefresh,
    showScrollButton,
    sidebarCollapsed,
    setSidebarCollapsed,
    showTools,
    setShowTools,
    convSearch,
    setConvSearch,
    convSearchMatch,
    setConvSearchMatch,
    chatInput,
    setChatInput,
    chatMode,
    claudeSessionId,
    cliModel,
    chatCwd,
    permissionMode,
    chatProvider,
    chatModel,
    compareMode,
    compareRightProvider,
    availableProviders,
    idCopied,
    cmdMenuIndex,
    setCmdMenuIndex,
    cmdMenuDismissed,
    setCmdMenuDismissed,

    // Refs
    chatContainerRef,

    // Streaming
    chatMessages,
    chatSending,
    currentPhase,
    elapsedMs,
    chatCancel,

    // Derived
    allCommands,
    showCommandMenu,
    visible,
    convSearchLower,
    matchedIndices,
    isSessionActive,
    isViewingSession,
    lastToolName,

    // Callbacks
    scrollToBottom,
    handleScroll,
    exportAsMarkdown,
    handleSend,
    handleCommandSelect,
    startNewChat,
    handleCopyId,
    handleViewInSessions,
    handleCwdChange,
    handlePermissionModeChange,
    handleProviderChange,
    handleModelChange,
    handleCompareModeChange,
  };
}
