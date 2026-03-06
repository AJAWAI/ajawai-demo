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
  user_id: string;
  key: string;
  value: string;
  category: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: string;
  user_id: string;
  conversation_id: string;
  role: "president" | "secretary_phi" | "manager_pico";
  type:
    | "user"
    | "assistant"
    | "informational_answer"
    | "action_completed"
    | "task_created"
    | "project_created"
    | "memory_saved"
    | "approval_required"
    | "error_failure"
    | "system_notice"
    | "task_created_card"
    | "project_created_card"
    | "note_saved_card"
    | "memory_saved_card"
    | "approval_request_card"
    | "gmail_connection_required_card"
    | "gmail_connected_status_card";
  content: string;
  payload?: Record<string, unknown>;
  created_at: string;
}

export interface LocalSetting {
  id: string;
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
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
  conversations!: EntityTable<Conversation, "id">;
  messages!: EntityTable<AgentMessage, "id">;
  settings!: EntityTable<LocalSetting, "id">;

  constructor() {
    super("ajawai-demo-db");
    this.version(5).stores({
      profiles: "id, user_id, updated_at",
      projects: "id, owner_id, status, updated_at",
      tasks: "id, project_id, status, priority, requires_approval, updated_at",
      contacts: "id, email, project_id, updated_at",
      notes: "id, user_id, project_id, updated_at",
      approvals: "id, action_type, status, updated_at",
      timeline: "id, event_type, project_id, updated_at",
      memory: "id, user_id, key, updated_at",
      conversations: "id, user_id, last_message_at, updated_at",
      messages: "id, user_id, conversation_id, role, type, created_at",
      settings: "id, user_id, key, updated_at"
    });
  }
}

export const db = new AjawaiDb();

export const nowIso = () => new Date().toISOString();
