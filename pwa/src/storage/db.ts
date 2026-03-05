import Dexie, { type EntityTable } from "dexie";

export interface Contact {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  jobId?: string;
  message: string;
  createdAt: string;
  kind: "info" | "approval" | "tool" | "error";
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  createdAt: string;
}

class AjawaiDb extends Dexie {
  contacts!: EntityTable<Contact, "id">;
  timeline!: EntityTable<TimelineEntry, "id">;
  memory!: EntityTable<MemoryEntry, "id">;

  constructor() {
    super("ajawai-demo-db");
    this.version(1).stores({
      contacts: "id, email, createdAt",
      timeline: "id, jobId, createdAt, kind",
      memory: "id, key, createdAt"
    });
  }
}

export const db = new AjawaiDb();
