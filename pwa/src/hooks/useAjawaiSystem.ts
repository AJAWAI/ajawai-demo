import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import {
  picoClawManager,
  type CommandDebugInfo,
  type Module3Snapshot
} from "../agents/picoClaw";
import { phiSystemStatus } from "../agents/phi";
import { syncWithSupabase, type SyncState as SyncStateType } from "../sync/supabaseSync";
import { supabase } from "../lib/supabase";

const initialSnapshot: Module3Snapshot = {
  profiles: [],
  projects: [],
  tasks: [],
  contacts: [],
  notes: [],
  approvals: [],
  timeline: [],
  memory: [],
  conversations: [],
  activeConversationId: null,
  messages: []
};

interface SyncState {
  state: SyncStateType;
  synced: boolean;
  detail: string;
  at: string;
}

const toUser = (session: Session): User => session.user;
const REQUEST_TIMEOUT_MS = 15_000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) => {
  let timer: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }
};

export const useAjawaiSystem = (session: Session) => {
  const user = useMemo(() => toUser(session), [session]);
  const [snapshot, setSnapshot] = useState<Module3Snapshot>(initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [gmailStatus, setGmailStatus] = useState<{
    connected: boolean;
    mode: "live" | "stub";
    detail: string;
  }>({
    connected: false,
    mode: "stub",
    detail: "Pending status check."
  });
  const [phiStatus, setPhiStatus] = useState(phiSystemStatus());
  const [toast, setToast] = useState<{
    kind: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const prevGmailConnected = useRef<boolean | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState<{
    message: string;
    command: string;
    conversationId: string;
    at: string;
  } | null>(null);
  const [debugTraces, setDebugTraces] = useState<CommandDebugInfo[]>([]);
  const [lastSuccessfulSyncAt, setLastSuccessfulSyncAt] = useState<string | null>(null);
  const activeRunId = useRef<number | null>(null);
  const runCounter = useRef(0);

  const refreshSnapshot = useCallback(async () => {
    const next = await picoClawManager.getSnapshot();
    setSnapshot(next);
    setPhiStatus(phiSystemStatus());
  }, []);

  const refreshGmailStatus = useCallback(async () => {
    const status = await picoClawManager.getGmailStatus();
    setGmailStatus(status);
  }, []);

  const syncNow = useCallback(async () => {
    try {
      const result = await syncWithSupabase(user.id);
      setSyncState(result);
      setPendingSync(!result.synced);
      if (result.synced) {
        setLastSuccessfulSyncAt(result.at);
      }
      await refreshSnapshot();
      return result;
    } catch (error) {
      const failureState: SyncState = {
        state: "sync_failed",
        synced: false,
        detail: error instanceof Error ? error.message : "Sync failed unexpectedly.",
        at: new Date().toISOString()
      };
      setSyncState(failureState);
      setPendingSync(true);
      return failureState;
    }
  }, [refreshSnapshot, user.id]);

  const markPendingSync = useCallback(
    (reason: string) => {
      const state: SyncState = {
        state: navigator.onLine ? "pending_sync" : "offline_cache_only",
        synced: false,
        detail: navigator.onLine
          ? `Pending sync: ${reason}`
          : `Offline cache only: ${reason}`,
        at: new Date().toISOString()
      };
      setPendingSync(true);
      setSyncState(state);
    },
    []
  );

  const queueOrSync = useCallback(
    async (reason: string) => {
      markPendingSync(reason);
      if (navigator.onLine) {
        await syncNow();
      }
    },
    [markPendingSync, syncNow]
  );

  useEffect(() => {
    const initialize = async () => {
      setBusy(true);
      try {
        if (navigator.onLine) {
          const preloadSync = await syncWithSupabase(user.id);
          setSyncState(preloadSync);
          setPendingSync(!preloadSync.synced);
          if (preloadSync.synced) {
            setLastSuccessfulSyncAt(preloadSync.at);
          }
        }
        await picoClawManager.bootstrap(user.id);
        await refreshSnapshot();
        await refreshGmailStatus();
        if (navigator.onLine) {
          await syncNow();
        } else {
          markPendingSync("Offline startup");
        }
      } catch (error) {
        setToast({
          kind: "error",
          message:
            error instanceof Error
              ? `Initialization issue: ${error.message}`
              : "Initialization issue."
        });
      } finally {
        setBusy(false);
      }
    };

    void initialize();
  }, [markPendingSync, refreshGmailStatus, refreshSnapshot, syncNow, user.id]);

  useEffect(() => {
    const onOnline = () => {
      if (pendingSync) {
        void syncNow();
      }
      void refreshGmailStatus();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [pendingSync, refreshGmailStatus, syncNow]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (navigator.onLine && !busy) {
        void syncNow();
      }
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [busy, syncNow]);

  useEffect(() => {
    if (prevGmailConnected.current === false && gmailStatus.connected) {
      setToast({
        kind: "success",
        message: "Gmail connected."
      });
    }
    prevGmailConnected.current = gmailStatus.connected;
  }, [gmailStatus.connected]);

  const runCommand = useCallback(
    async (command: string, conversationId: string) => {
      if (!command.trim()) {
        return;
      }
      const nextRunId = ++runCounter.current;
      activeRunId.current = nextRunId;
      setChatError(null);
      setThinking(true);
      setBusy(true);
      try {
        const result = await withTimeout(
          picoClawManager.executeSecretaryCommand(user.id, conversationId, command),
          REQUEST_TIMEOUT_MS,
          "Request timed out. Please retry."
        );
        if (result?.debug) {
          setDebugTraces((prev) => [result.debug as CommandDebugInfo, ...prev].slice(0, 15));
        }
        if (activeRunId.current !== nextRunId) {
          return;
        }
        await refreshSnapshot();
        await queueOrSync("New chat interaction").catch(() => undefined);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Request failed. Please retry your message.";
        const errorTrace: CommandDebugInfo = {
          turn_number: 0,
          intent: "error",
          route: "direct_conversational",
          search_used: false,
          pico_used: false,
          memory_used: false,
          fallback_triggered: false,
          template_fallback_used: false,
          quality_guard_triggered: false,
          at: new Date().toISOString()
        };
        setDebugTraces((prev) => [errorTrace, ...prev].slice(0, 15));
        setChatError({
          message,
          command,
          conversationId,
          at: new Date().toISOString()
        });
        setToast({
          kind: "error",
          message
        });
      } finally {
        if (activeRunId.current === nextRunId) {
          activeRunId.current = null;
        }
        setThinking(false);
        setBusy(false);
      }
    },
    [queueOrSync, refreshSnapshot, user.id]
  );

  const resetThinkingState = useCallback(() => {
    activeRunId.current = null;
    setThinking(false);
    setBusy(false);
    setChatError(null);
  }, []);

  const retryLastCommand = useCallback(async () => {
    if (!chatError) {
      return;
    }
    await runCommand(chatError.command, chatError.conversationId);
  }, [chatError, runCommand]);

  const approve = useCallback(
    async (approvalId: string, conversationId: string) => {
      setBusy(true);
      try {
        const result = await picoClawManager.approve(approvalId, conversationId);
        if (result.kind === "gmail_not_connected") {
          setToast({
            kind: "error",
            message: "Gmail not connected. Opening connect flow."
          });
          if (result.connectUrl) {
            window.open(result.connectUrl, "_blank", "noopener,noreferrer");
          }
        } else if (result.ok) {
          setToast({
            kind: "success",
            message:
              result.kind === "gmail_send_success" ? "Gmail send success." : "Approval completed."
          });
        } else {
          setToast({
            kind: "error",
            message: result.message
          });
        }
        await refreshSnapshot();
        await refreshGmailStatus();
        await queueOrSync("Approval update");
      } finally {
        setBusy(false);
      }
    },
    [queueOrSync, refreshGmailStatus, refreshSnapshot]
  );

  const reject = useCallback(
    async (approvalId: string, conversationId: string) => {
      setBusy(true);
      try {
        const result = await picoClawManager.reject(approvalId, conversationId);
        setToast({
          kind: result.ok ? "info" : "error",
          message: result.message
        });
        await refreshSnapshot();
        await queueOrSync("Approval rejection update");
      } finally {
        setBusy(false);
      }
    },
    [queueOrSync, refreshSnapshot]
  );

  const connectGmail = useCallback(async () => {
    const connectUrl = await picoClawManager.getGmailConnectUrl();
    if (connectUrl) {
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      setToast({
        kind: "info",
        message: "Opened Gmail connect flow."
      });
    } else {
      setToast({
        kind: "error",
        message: "Gmail connect URL unavailable. Check relay OAuth configuration."
      });
    }
  }, []);

  const createConversation = useCallback(async () => {
    setBusy(true);
    try {
      const conversation = await picoClawManager.createConversation(user.id);
      await refreshSnapshot();
      await queueOrSync("New conversation");
      return conversation.id;
    } finally {
      setBusy(false);
    }
  }, [queueOrSync, refreshSnapshot, user.id]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      await picoClawManager.selectConversation(conversationId);
      await refreshSnapshot();
      await queueOrSync("Conversation selection settings");
    },
    [queueOrSync, refreshSnapshot]
  );

  const activeConversationId = snapshot.activeConversationId ?? snapshot.conversations[0]?.id ?? null;
  const activeConversationMessages = useMemo(() => {
    if (!activeConversationId) {
      return [];
    }
    const filtered = snapshot.messages.filter(
      (message) => message.conversation_id === activeConversationId
    );
    filtered.sort((a, b) => {
      const delta = Date.parse(a.created_at) - Date.parse(b.created_at);
      if (delta !== 0) {
        return delta;
      }
      return a.id.localeCompare(b.id);
    });
    const seen = new Set<string>();
    const semanticSeen = new Map<string, number>();
    return filtered.filter((message) => {
      if (seen.has(message.id)) {
        return false;
      }
      seen.add(message.id);

      if (message.role !== "president") {
        const semanticKey = `${message.role}|${message.type}|${message.content.trim().toLowerCase()}`;
        const currentTs = Date.parse(message.created_at);
        const previousTs = semanticSeen.get(semanticKey);
        if (
          typeof previousTs === "number" &&
          Number.isFinite(currentTs) &&
          Math.abs(currentTs - previousTs) < 2_000
        ) {
          return false;
        }
        semanticSeen.set(semanticKey, currentTs);
      }
      return true;
    });
  }, [activeConversationId, snapshot.messages]);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    user,
    busy,
    snapshot,
    syncState,
    pendingSync,
    gmailStatus,
    phiStatus,
    toast,
    thinking,
    chatError,
    activeConversationId,
    activeConversationMessages,
    runCommand,
    retryLastCommand,
    resetThinkingState,
    debugTraces,
    lastSuccessfulSyncAt,
    approve,
    reject,
    syncNow,
    refreshGmailStatus,
    connectGmail,
    createConversation,
    selectConversation,
    clearToast,
    logout
  };
};
