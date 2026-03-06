import { supabase } from "../lib/supabase";
import { db, nowIso } from "../storage/db";

const supabaseClient = supabase as any;

type SyncableRow = {
  id: string;
  updated_at?: string;
  created_at?: string;
};

export type SyncState = "synced" | "pending_sync" | "offline_cache_only" | "sync_failed";
export type SyncDomainState = "synced" | "failed" | "skipped";

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

export type SyncDomainStatus = {
  state: SyncDomainState;
  detail: string;
  critical: boolean;
};

export type SyncDomainStatusMap = Partial<Record<TableName, SyncDomainStatus>>;

type TableConfig<T extends SyncableRow> = {
  name: TableName;
  readLocal: () => Promise<T[]>;
  writeLocal: (rows: T[]) => Promise<unknown>;
  critical: boolean;
  filterColumn?: string;
  onConflict?: string;
  normalizeRows?: (rows: T[]) => T[];
};

const isSkippableTableError = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? "";
  const message = (error as { message?: string })?.message ?? "";
  const normalized = `${code} ${message}`.toLowerCase();
  return (
    normalized.includes("42p01") ||
    normalized.includes("does not exist") ||
    normalized.includes("permission denied") ||
    normalized.includes("42501") ||
    normalized.includes("not authorized")
  );
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
    let upsertResult = await supabaseClient.from(config.name).upsert(normalizedRows as unknown[], {
      onConflict: config.onConflict ?? "id"
    });
    if (upsertResult.error && config.onConflict && config.onConflict !== "id") {
      upsertResult = await supabaseClient.from(config.name).upsert(normalizedRows as unknown[], {
        onConflict: "id"
      });
    }
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
      domains: {} as SyncDomainStatusMap,
      at: nowIso()
    };
  }

  try {
    const sessionResult = await supabaseClient.auth.getSession();
    const sessionUserId = sessionResult?.data?.session?.user?.id as string | undefined;
    if (!sessionUserId) {
      return {
        state: "sync_failed" as SyncState,
        synced: false,
        detail: "Sync failed: no authenticated Supabase session.",
        domains: {} as SyncDomainStatusMap,
        at: nowIso()
      };
    }
    if (sessionUserId !== userId) {
      return {
        state: "sync_failed" as SyncState,
        synced: false,
        detail: "Sync failed: user/session mismatch.",
        domains: {} as SyncDomainStatusMap,
        at: nowIso()
      };
    }

    const tables: TableConfig<SyncableRow>[] = [
      {
        name: "profiles",
        critical: true,
        filterColumn: "user_id",
        readLocal: () => db.profiles.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.profiles.bulkPut(rows as any)
      },
      {
        name: "projects",
        critical: false,
        filterColumn: "owner_id",
        readLocal: () => db.projects.where("owner_id").equals(userId).toArray(),
        writeLocal: (rows) => db.projects.bulkPut(rows as any)
      },
      {
        name: "tasks",
        critical: false,
        readLocal: () => db.tasks.toArray(),
        writeLocal: (rows) => db.tasks.bulkPut(rows as any)
      },
      {
        name: "contacts",
        critical: false,
        readLocal: () => db.contacts.toArray(),
        writeLocal: (rows) => db.contacts.bulkPut(rows as any)
      },
      {
        name: "notes",
        critical: false,
        filterColumn: "user_id",
        readLocal: () => db.notes.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.notes.bulkPut(rows as any)
      },
      {
        name: "approvals",
        critical: false,
        readLocal: () => db.approvals.toArray(),
        writeLocal: (rows) => db.approvals.bulkPut(rows as any)
      },
      {
        name: "timeline",
        critical: false,
        readLocal: () => db.timeline.toArray(),
        writeLocal: (rows) => db.timeline.bulkPut(rows as any)
      },
      {
        name: "memory",
        critical: true,
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
        critical: true,
        filterColumn: "user_id",
        readLocal: () => db.conversations.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.conversations.bulkPut(rows as any)
      },
      {
        name: "messages",
        critical: true,
        filterColumn: "user_id",
        readLocal: () => db.messages.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.messages.bulkPut(rows as any)
      },
      {
        name: "settings",
        critical: true,
        filterColumn: "user_id",
        readLocal: () => db.settings.where("user_id").equals(userId).toArray(),
        writeLocal: (rows) => db.settings.bulkPut(rows as any)
      }
    ];

    const domains: SyncDomainStatusMap = {};
    const settled = await Promise.allSettled(
      tables.map(async (table) => {
        try {
          await syncTable(table, userId);
          return {
            name: table.name,
            critical: table.critical,
            state: "synced" as SyncDomainState,
            detail: "Synced"
          };
        } catch (error) {
          const reason = error instanceof Error ? error.message : "sync failed";
          const skippable = !table.critical && isSkippableTableError(error);
          return {
            name: table.name,
            critical: table.critical,
            state: (skippable ? "skipped" : "failed") as SyncDomainState,
            detail: reason
          };
        }
      })
    );

    const criticalFailures: string[] = [];
    const optionalFailures: string[] = [];
    const optionalSkips: string[] = [];
    for (const result of settled) {
      if (result.status !== "fulfilled") {
        continue;
      }
      const row = result.value;
      domains[row.name] = {
        state: row.state,
        detail: row.detail,
        critical: row.critical
      };
      if (row.state === "failed" && row.critical) {
        criticalFailures.push(`${row.name}: ${row.detail}`);
      } else if (row.state === "failed") {
        optionalFailures.push(`${row.name}: ${row.detail}`);
      } else if (row.state === "skipped") {
        optionalSkips.push(`${row.name}: ${row.detail}`);
      }
    }

    if (criticalFailures.length > 0) {
      return {
        state: "sync_failed" as SyncState,
        synced: false,
        detail: `Critical sync failed: ${criticalFailures.join(" | ")}`,
        domains,
        at: nowIso()
      };
    }

    const hasOptionalIssues = optionalFailures.length > 0 || optionalSkips.length > 0;
    const detailSegments = ["Core sync succeeded (critical tables)."];
    if (optionalFailures.length > 0) {
      detailSegments.push(`Optional failures: ${optionalFailures.join(" | ")}`);
    }
    if (optionalSkips.length > 0) {
      detailSegments.push(`Optional skips: ${optionalSkips.join(" | ")}`);
    }

    return {
      state: hasOptionalIssues ? ("pending_sync" as SyncState) : ("synced" as SyncState),
      synced: !hasOptionalIssues,
      detail: hasOptionalIssues
        ? detailSegments.join(" ")
        : "Local cache synced to Supabase (last-write-wins).",
      domains,
      at: nowIso()
    };
  } catch (error) {
    return {
      state: "sync_failed" as SyncState,
      synced: false,
      detail: error instanceof Error ? error.message : "Sync failed.",
      domains: {} as SyncDomainStatusMap,
      at: nowIso()
    };
  }
};
