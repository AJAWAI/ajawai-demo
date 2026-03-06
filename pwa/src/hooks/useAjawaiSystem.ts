import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import type { Task } from "@ajawai/shared";
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

  const runCommand = useCallback(
    async (command: string) => {
      if (!command.trim()) {
        return;
      }
      setBusy(true);
      try {
        await picoClawManager.executeSecretaryCommand(user.id, command);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot, user.id]
  );

  const approve = useCallback(
    async (approvalId: string) => {
      setBusy(true);
      try {
        await picoClawManager.approve(approvalId);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const reject = useCallback(
    async (approvalId: string) => {
      setBusy(true);
      try {
        await picoClawManager.reject(approvalId);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const createProject = useCallback(
    async (name: string, description: string) => {
      setBusy(true);
      try {
        await picoClawManager.createProjectFromForm(user.id, name, description);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot, user.id]
  );

  const createTask = useCallback(
    async (title: string, description: string, priority: Task["priority"]) => {
      setBusy(true);
      try {
        await picoClawManager.createTaskFromForm(title, description, priority);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const setTaskStatus = useCallback(
    async (taskId: string, status: Task["status"]) => {
      setBusy(true);
      try {
        await picoClawManager.setTaskStatus(taskId, status);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot]
  );

  const createNote = useCallback(
    async (title: string, content: string) => {
      setBusy(true);
      try {
        await picoClawManager.createNoteFromForm(user.id, title, content);
        await refreshSnapshot();
      } finally {
        setBusy(false);
      }
    },
    [refreshSnapshot, user.id]
  );

  const createContact = useCallback(
    async (name: string, email: string, company: string, phone: string) => {
      setBusy(true);
      try {
        await picoClawManager.createContactFromForm({ name, email, company, phone });
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
    }
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
    runCommand,
    approve,
    reject,
    createProject,
    createTask,
    setTaskStatus,
    createNote,
    createContact,
    syncNow,
    refreshGmailStatus,
    connectGmail,
    logout
  };
};
