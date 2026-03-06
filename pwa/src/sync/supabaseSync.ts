import { supabase } from "../lib/supabase";
import { db, nowIso } from "../storage/db";

type SyncableRow = {
  id: string;
  updated_at?: string;
  created_at?: string;
};

const readTimestamp = (row: SyncableRow) => row.updated_at ?? row.created_at ?? "";

const isRemoteNewer = (remote: SyncableRow, local: SyncableRow | undefined) => {
  if (!local) {
    return true;
  }
  return readTimestamp(remote) > readTimestamp(local);
};

const syncTable = async <T extends SyncableRow>(
  tableName: "profiles" | "projects" | "tasks" | "contacts" | "notes" | "approvals" | "timeline",
  localRows: T[],
  saveLocalRows: (rows: T[]) => Promise<unknown>
) => {
  const upsertResult = await supabase.from(tableName).upsert(localRows, {
    onConflict: "id"
  });
  if (upsertResult.error) {
    throw upsertResult.error;
  }

  const remoteResult = await supabase.from(tableName).select("*").limit(500);
  if (remoteResult.error) {
    throw remoteResult.error;
  }

  const remoteRows = (remoteResult.data ?? []) as T[];
  const localMap = new Map(localRows.map((row) => [row.id, row]));

  const rowsToWriteLocal: T[] = [];
  for (const remote of remoteRows) {
    const local = localMap.get(remote.id);
    if (isRemoteNewer(remote, local)) {
      rowsToWriteLocal.push(remote);
    }
  }

  if (rowsToWriteLocal.length > 0) {
    await saveLocalRows(rowsToWriteLocal);
  }
};

export const syncWithSupabase = async (userId: string) => {
  if (!navigator.onLine) {
    return {
      synced: false,
      detail: "Offline. Sync deferred.",
      at: nowIso()
    };
  }

  try {
    const [profiles, projects, tasks, contacts, notes, approvals, timeline] = await Promise.all([
      db.profiles.where("user_id").equals(userId).toArray(),
      db.projects.where("owner_id").equals(userId).toArray(),
      db.tasks.toArray(),
      db.contacts.toArray(),
      db.notes.where("user_id").equals(userId).toArray(),
      db.approvals.toArray(),
      db.timeline.toArray()
    ]);

    await syncTable("profiles", profiles, async (rows) => {
      await db.profiles.bulkPut(rows);
    });
    await syncTable("projects", projects, async (rows) => {
      await db.projects.bulkPut(rows);
    });
    await syncTable("tasks", tasks, async (rows) => {
      await db.tasks.bulkPut(rows);
    });
    await syncTable("contacts", contacts, async (rows) => {
      await db.contacts.bulkPut(rows);
    });
    await syncTable("notes", notes, async (rows) => {
      await db.notes.bulkPut(rows);
    });
    await syncTable("approvals", approvals, async (rows) => {
      await db.approvals.bulkPut(rows);
    });
    await syncTable("timeline", timeline, async (rows) => {
      await db.timeline.bulkPut(rows);
    });

    return {
      synced: true,
      detail: "Local cache synced to Supabase (last-write-wins).",
      at: nowIso()
    };
  } catch (error) {
    return {
      synced: false,
      detail: error instanceof Error ? error.message : "Sync failed.",
      at: nowIso()
    };
  }
};
