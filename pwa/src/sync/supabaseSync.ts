import { supabase } from "../lib/supabase";
import { db, nowIso } from "../storage/db";

const supabaseClient = supabase as any;

type SyncableRow = {
  id: string;
  updated_at?: string;
  created_at?: string;
};

export type SyncState = "synced" | "pending_sync" | "offline_cache_only";

const readTimestamp = (row: SyncableRow) =>
  Date.parse(row.updated_at ?? row.created_at ?? "1970-01-01T00:00:00.000Z");

const chooseWinner = <T extends SyncableRow>(local?: T, remote?: T): T | null => {
  if (!local && !remote) {
    return null;
  }
  if (!local && remote) {
    return remote;
  }
  if (!remote && local) {
    return local;
  }
  if (!local || !remote) {
    return null;
  }
  return readTimestamp(local) >= readTimestamp(remote) ? local : remote;
};

type TableName =
  | "profiles"
  | "projects"
  | "tasks"
  | "contacts"
  | "notes"
  | "approvals"
  | "timeline"
  | "memory"
  | "conversations"
  | "messages"
  | "settings";

type TableConfig<T extends SyncableRow> = {
  name: TableName;
  readLocal: () => Promise<T[]>;
  writeLocal: (rows: T[]) => Promise<unknown>;
  filterColumn?: string;
  onConflict?: string;
  normalizeRows?: (rows: T[]) => T[];
};

const dedupeRows = <T extends SyncableRow>(
  rows: T[],
  keyOf: (row: T) => string
): T[] => {
  const winners = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    const existing = winners.get(key);
    if (!existing || readTimestamp(row) >= readTimestamp(existing)) {
      winners.set(key, row);
    }
  }
  return Array.from(winners.values());
};

const syncTable = async <T extends SyncableRow>(config: TableConfig<T>, userId: string) => {
  let query = supabaseClient.from(config.name).select("*").limit(1000);
  if (config.filterColumn) {
    query = query.eq(config.filterColumn, userId);
  }
  const remoteResult = await query;
  if (remoteResult.error) {
    throw remoteResult.error;
  }

  const localRows = await config.readLocal();
  const remoteRows = (remoteResult.data ?? []) as T[];

  const localMap = new Map(localRows.map((row) => [row.id, row]));
  const remoteMap = new Map(remoteRows.map((row) => [row.id, row]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const winners: T[] = [];
  for (const id of allIds) {
    const winner = chooseWinner(localMap.get(id), remoteMap.get(id));
    if (winner) {
      winners.push(winner);
    }
  }

  const normalizedRows = config.normalizeRows ? config.normalizeRows(winners) : winners;

  if (normalizedRows.length > 0) {
    await config.writeLocal(normalizedRows);
    const upsertResult = await supabaseClient.from(config.name).upsert(normalizedRows as unknown[], {
      onConflict: config.onConflict ?? "id"
    });
    if (upsertResult.error) {
      throw upsertResult.error;
    }
  }
};

export const syncWithSupabase = async (userId: string) => {
  if (!navigator.onLine) {
    return {
      state: "offline_cache_only" as SyncState,
      synced: false,
      detail: "Offline. Sync deferred.",
      at: nowIso()
    };
  }

  try {
    const tables: TableConfig<SyncableRow>[] = [
      {
        name: "profiles",
        filterColumn: "user_id",
        readLocal: () => db.profiles.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.profiles.bulkPut(rows as any)
      },
      {
        name: "projects",
        filterColumn: "owner_id",
        readLocal: () => db.projects.where("owner_id").equals(userId).toArray(),
        writeLocal: (rows) => db.projects.bulkPut(rows as any)
      },
      {
        name: "tasks",
        readLocal: () => db.tasks.toArray(),
        writeLocal: (rows) => db.tasks.bulkPut(rows as any)
      },
      {
        name: "contacts",
        readLocal: () => db.contacts.toArray(),
        writeLocal: (rows) => db.contacts.bulkPut(rows as any)
      },
      {
        name: "notes",
        filterColumn: "user_id",
        readLocal: () => db.notes.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.notes.bulkPut(rows as any)
      },
      {
        name: "approvals",
        readLocal: () => db.approvals.toArray(),
        writeLocal: (rows) => db.approvals.bulkPut(rows as any)
      },
      {
        name: "timeline",
        readLocal: () => db.timeline.toArray(),
        writeLocal: (rows) => db.timeline.bulkPut(rows as any)
      },
      {
        name: "memory",
        filterColumn: "user_id",
        readLocal: () => db.memory.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.memory.bulkPut(rows as any),
        onConflict: "user_id,key",
        normalizeRows: (rows) =>
          dedupeRows(
            rows,
            (row) =>
              `${(row as { user_id?: string; key?: string }).user_id ?? ""}:${
                (row as { user_id?: string; key?: string }).key ?? ""
              }`
          )
      },
      {
        name: "conversations",
        filterColumn: "user_id",
        readLocal: () => db.conversations.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.conversations.bulkPut(rows as any)
      },
      {
        name: "messages",
        filterColumn: "user_id",
        readLocal: () => db.messages.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.messages.bulkPut(rows as any)
      },
      {
        name: "settings",
        filterColumn: "user_id",
        readLocal: () => db.settings.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.settings.bulkPut(rows as any)
      }
    ];

    for (const table of tables) {
      await syncTable(table, userId);
    }

    return {
      state: "synced" as SyncState,
      synced: true,
      detail: "Local cache synced to Supabase (last-write-wins).",
      at: nowIso()
    };
  } catch (error) {
    return {
      state: "pending_sync" as SyncState,
      synced: false,
      detail: error instanceof Error ? error.message : "Sync failed.",
      at: nowIso()
    };
  }
};
