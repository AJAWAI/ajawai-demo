import Dexie, { type EntityTable } from "dexie";
import type {
  Approval,
  Contact,
  Note,
  Profile,
  Project,
  Task,
  Timeline
} from "@ajawai/shared";

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  role: "president" | "secretary_phi" | "manager_pico";
  content: string;
  created_at: string;
}

export interface LocalSetting {
  key: string;
  value: string;
  updated_at: string;
}

class AjawaiDb extends Dexie {
  profiles!: EntityTable<Profile, "id">;
  projects!: EntityTable<Project, "id">;
  tasks!: EntityTable<Task, "id">;
  contacts!: EntityTable<Contact, "id">;
  notes!: EntityTable<Note, "id">;
  approvals!: EntityTable<Approval, "id">;
  timeline!: EntityTable<Timeline, "id">;
  memory!: EntityTable<MemoryEntry, "id">;
  messages!: EntityTable<AgentMessage, "id">;
  settings!: EntityTable<LocalSetting, "key">;

  constructor() {
    super("ajawai-demo-db");
    this.version(2).stores({
      profiles: "id, user_id, updated_at",
      projects: "id, owner_id, status, updated_at",
      tasks: "id, project_id, status, priority, requires_approval, updated_at",
      contacts: "id, email, project_id, updated_at",
      notes: "id, user_id, project_id, updated_at",
      approvals: "id, action_type, status, updated_at",
      timeline: "id, event_type, project_id, updated_at",
      memory: "id, key, updated_at",
      messages: "id, role, created_at",
      settings: "key, updated_at"
    });
  }
}

export const db = new AjawaiDb();

export const nowIso = () => new Date().toISOString();
