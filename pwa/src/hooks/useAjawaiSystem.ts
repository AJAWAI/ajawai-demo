import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { picoClawManager, type Module3Snapshot } from "../agents/picoClaw";
import { phiSystemStatus } from "../agents/phi";
import { syncWithSupabase } from "../sync/supabaseSync";
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
  synced: boolean;
  detail: string;
  at: string;
}

const toUser = (session: Session): User => session.user;

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
    const result = await syncWithSupabase(user.id);
    setSyncState(result);
    await refreshSnapshot();
    return result;
  }, [refreshSnapshot, user.id]);

  useEffect(() => {
    const initialize = async () => {
      setBusy(true);
      await picoClawManager.bootstrap(user.id);
      await refreshSnapshot();
      await refreshGmailStatus();
      setBusy(false);
    };

    void initialize();
  }, [refreshGmailStatus, refreshSnapshot, user.id]);

  useEffect(() => {
    const onOnline = () => {
      void syncNow();
      void refreshGmailStatus();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refreshGmailStatus, syncNow]);

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
      setBusy(true);
      try {
        await picoClawManager.executeSecretaryCommand(user.id, conversationId, command);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot, user.id]
  );

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
      } finally {
        setBusy(false);
      }
    },
    [refreshGmailStatus, refreshSnapshot]
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
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot]
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
      return conversation.id;
    } finally {
      setBusy(false);
    }
  }, [refreshSnapshot, user.id]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      await picoClawManager.selectConversation(conversationId);
      await refreshSnapshot();
    },
    [refreshSnapshot]
  );

  const activeConversationId = snapshot.activeConversationId ?? snapshot.conversations[0]?.id ?? null;
  const activeConversationMessages = useMemo(() => {
    if (!activeConversationId) {
      return [];
    }
    return snapshot.messages.filter((message) => message.conversation_id === activeConversationId);
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
    gmailStatus,
    phiStatus,
    toast,
    activeConversationId,
    activeConversationMessages,
    runCommand,
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
