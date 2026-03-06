import type {
  Approval,
  Contact,
  Note,
  Profile,
  Project,
  Task,
  Timeline
} from "@ajawai/shared";
import {
  db,
  nowIso,
  type AgentMessage,
  type Conversation,
  type MemoryEntry
} from "../storage/db";
import { localCache } from "../storage/cache";
import { MANAGER_NAME, SECRETARY_NAME } from "../constants/module3";
import { getLastPhiDebugMeta, phiDirectAnswer, phiLLM, phiSynthesizeSearchAnswer } from "./phi";
import { runPublicWebSearch, type PublicWebSearchResult } from "../search/publicWebSearch";

const relayBaseUrl =
  import.meta.env.VITE_RELAY_BASE_URL ?? "http://localhost:8787";

interface SendEmailApprovalPayload {
  to: string[];
  subject: string;
  body: string;
  task_id: string | null;
}

interface CreateTaskApprovalPayload {
  title: string;
  description: string;
}

interface ContactSubcontractorApprovalPayload {
  name: string;
  email: string;
}

interface GmailStatus {
  connected: boolean;
  mode: "live" | "stub";
  detail: string;
}

export interface ActionResult {
  ok: boolean;
  kind:
    | "approved"
    | "rejected"
    | "gmail_not_connected"
    | "gmail_send_success"
    | "gmail_send_failed";
  message: string;
  connectUrl?: string | null;
}

type SecretaryResponseType =
  | "informational_answer"
  | "action_completed"
  | "task_created"
  | "project_created"
  | "memory_saved"
  | "approval_required"
  | "error_failure";

interface CommandOutcome {
  type: SecretaryResponseType;
  ok: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

export interface CommandDebugInfo {
  intent: string;
  route:
    | "direct_conversational"
    | "memory_recall"
    | "memory_save"
    | "search_assisted_conversational"
    | "status_query"
    | "pico_operational";
  search_used: boolean;
  pico_used: boolean;
  memory_used: boolean;
  fallback_triggered: boolean;
  quality_guard_triggered: boolean;
  at: string;
}

export interface Module3Snapshot {
  profiles: Profile[];
  projects: Project[];
  tasks: Task[];
  contacts: Contact[];
  notes: Note[];
  approvals: Approval[];
  timeline: Timeline[];
  memory: MemoryEntry[];
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: AgentMessage[];
}

const parseSendEmailPayload = (approval: Approval): SendEmailApprovalPayload | null => {
  const payload = approval.payload as Partial<SendEmailApprovalPayload>;
  if (!payload || !Array.isArray(payload.to) || !payload.subject || !payload.body) {
    return null;
  }
  return {
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    task_id: payload.task_id ?? null
  };
};

const parseCreateTaskPayload = (approval: Approval): CreateTaskApprovalPayload | null => {
  const payload = approval.payload as Partial<CreateTaskApprovalPayload>;
  if (!payload?.title) {
    return null;
  }
  return {
    title: payload.title,
    description: payload.description ?? ""
  };
};

const parseContactPayload = (approval: Approval): ContactSubcontractorApprovalPayload | null => {
  const payload = approval.payload as Partial<ContactSubcontractorApprovalPayload>;
  if (!payload?.name || !payload?.email) {
    return null;
  }
  return {
    name: payload.name,
    email: payload.email
  };
};

const safeText = (value: string | undefined, fallback: string) => {
  return value && value.trim().length > 0 ? value.trim() : fallback;
};

const cleanSnippet = (text: string) => text.replace(/\s+/g, " ").trim();
const fillerPatterns = [
  /start by defining the exact outcome/i,
  /tell me any constraints/i,
  /best understood by its purpose/i,
  /i reviewed the request/i
];

const sortByDateDesc = <T>(rows: T[], readDate: (row: T) => string) => {
  return [...rows].sort((a, b) => {
    const delta = Date.parse(readDate(b)) - Date.parse(readDate(a));
    if (delta !== 0) {
      return delta;
    }
    const aId = (a as { id?: string }).id ?? "";
    const bId = (b as { id?: string }).id ?? "";
    return aId.localeCompare(bId);
  });
};

const sortByDateAsc = <T>(rows: T[], readDate: (row: T) => string) => {
  return [...rows].sort((a, b) => {
    const delta = Date.parse(readDate(a)) - Date.parse(readDate(b));
    if (delta !== 0) {
      return delta;
    }
    const aId = (a as { id?: string }).id ?? "";
    const bId = (b as { id?: string }).id ?? "";
    return aId.localeCompare(bId);
  });
};

const isStatusRequest = (command: string) => {
  const normalized = command.toLowerCase();
  return (
    normalized.includes("system status") ||
    normalized.includes("confirm the system is running") ||
    normalized.includes("show current system status") ||
    normalized.includes("status")
  );
};

const normalizeMemoryKey = (raw: string) => {
  return raw
    .replace(/\?+$/, "")
    .replace(/^my\s+/i, "")
    .trim()
    .toLowerCase();
};

const parseMemorySaveFromCommand = (input: string): { key: string; value: string } | null => {
  const explicit = input.match(/(?:store|save)\s+memory:\s*(.+)$/i);
  const remember = input.match(/remember(?:\s+that|\s+this)?[:\s]+(.+)$/i);
  const statement = explicit?.[1] ?? remember?.[1];
  if (!statement) {
    return null;
  }

  const keyValueMatch = statement.match(/^(.+?)\s+is\s+(.+)$/i);
  if (keyValueMatch) {
    return {
      key: normalizeMemoryKey(keyValueMatch[1]),
      value: keyValueMatch[2].trim().replace(/\.$/, "")
    };
  }
  return {
    key: "note",
    value: statement.trim().replace(/\.$/, "")
  };
};

const parseMemoryRecallFromCommand = (input: string): string | null => {
  const trimmed = input.trim();
  const patterns = [
    /what is my (.+)\??$/i,
    /what's my (.+)\??$/i,
    /what do you know about (.+)\??$/i,
    /do you remember (.+)\??$/i,
    /recall (.+)\??$/i
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return normalizeMemoryKey(match[1]);
    }
  }
  return null;
};

export class PicoClawManager {
  private currentUserId: string | null = null;
  private activeConversationSettingKey = "active_conversation_id";

  private settingId(key: string) {
    const uid = this.currentUserId ?? "anonymous";
    return `${uid}:${key}`;
  }

  async bootstrap(userId: string) {
    this.currentUserId = userId;
    const existing = await db.profiles.where("user_id").equals(userId).first();
    if (!existing) {
      const profile: Profile = {
        id: crypto.randomUUID(),
        user_id: userId,
        full_name: "President",
        company: "AJAWAI",
        role: "President",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        created_at: nowIso(),
        updated_at: nowIso()
      };
      await db.profiles.put(profile);
      await this.logTimeline("profile_created", "Profile initialized for local-first OS.", null);
    }

    const activeConversationId = await this.ensureActiveConversation(userId);
    const profile = await db.profiles.where("user_id").equals(userId).first();

    return profile!;
  }

  async getSnapshot(): Promise<Module3Snapshot> {
    const cached = localCache.get<Module3Snapshot>("module3:snapshot");
    if (cached) {
      return cached;
    }

    const profiles = await db.profiles.where("user_id").equals(this.currentUserId ?? "").toArray();
    const projects = await db.projects.where("owner_id").equals(this.currentUserId ?? "").toArray();
    const tasks = await db.tasks.toArray();
    const contacts = await db.contacts.toArray();
    const notes = await db.notes.where("user_id").equals(this.currentUserId ?? "").toArray();
    const approvals = await db.approvals.toArray();
    const timeline = await db.timeline.toArray();
    const memory = await db.memory.where("user_id").equals(this.currentUserId ?? "").toArray();
    const conversations = await db.conversations
      .where("user_id")
      .equals(this.currentUserId ?? "")
      .toArray();
    const messages = await db.messages.where("user_id").equals(this.currentUserId ?? "").toArray();

    const snapshot: Module3Snapshot = {
      profiles: sortByDateDesc(profiles, (row) => row.updated_at),
      projects: sortByDateDesc(projects, (row) => row.updated_at),
      tasks: sortByDateDesc(tasks, (row) => row.updated_at),
      contacts: sortByDateDesc(contacts, (row) => row.updated_at),
      notes: sortByDateDesc(notes, (row) => row.updated_at),
      approvals: sortByDateDesc(approvals, (row) => row.updated_at),
      timeline: sortByDateDesc(timeline, (row) => row.updated_at),
      memory: sortByDateDesc(memory, (row) => row.updated_at),
      conversations: sortByDateDesc(conversations, (row) => row.last_message_at),
      activeConversationId: await this.getActiveConversationId(),
      messages: sortByDateAsc(messages, (row) => row.created_at)
    };
    localCache.set("module3:snapshot", snapshot, 10_000);
    return snapshot;
  }

  private invalidateSnapshot() {
    localCache.invalidate("module3:snapshot");
  }

  private async addMessage(input: {
    conversationId: string;
    role: AgentMessage["role"];
    type: AgentMessage["type"];
    content: string;
    payload?: Record<string, unknown>;
  }) {
    const createdAt = nowIso();
    await db.messages.put({
      id: crypto.randomUUID(),
      user_id: this.currentUserId ?? "anonymous",
      conversation_id: input.conversationId,
      role: input.role,
      type: input.type,
      content: input.content,
      payload: input.payload,
      created_at: createdAt,
      updated_at: createdAt
    });
    await db.conversations.update(input.conversationId, {
      updated_at: createdAt,
      last_message_at: createdAt
    });
    this.invalidateSnapshot();
  }

  private async addSecretaryFinalMessage(
    conversationId: string,
    type: SecretaryResponseType,
    content: string,
    payload?: Record<string, unknown>
  ) {
    await this.addMessage({
      conversationId,
      role: "secretary_phi",
      type,
      content,
      payload
    });
  }

  private buildSecretaryFinalResponse(outcome: CommandOutcome): string {
    switch (outcome.type) {
      case "informational_answer":
        return outcome.summary;
      case "project_created":
        return `Project created successfully. ${outcome.summary}`;
      case "task_created":
        return `Task created and ready. ${outcome.summary}`;
      case "memory_saved":
        return `Got it — memory saved. ${outcome.summary}`;
      case "approval_required":
        return `${outcome.summary} The action is queued and awaiting your approval.`;
      case "error_failure":
        return `I hit an issue: ${outcome.summary}`;
      case "action_completed":
      default:
        return outcome.summary;
    }
  }

  private async getSystemStatusSummary(userId: string) {
    const gmail = await this.getGmailStatus();
    const memoryCount = await db.memory.where("user_id").equals(userId).count();
    const chatCount = await db.conversations.where("user_id").equals(userId).count();
    const profile = await db.profiles.where("user_id").equals(userId).first();
    const modules = [
      "Secretary Phi",
      "Manager Pico Claw",
      "Projects",
      "Tasks",
      "Notes",
      "Contacts",
      "Approvals",
      "Timeline",
      "Memory"
    ];
    const online = navigator.onLine ? "online" : "offline";
    const picoState = "active";
    const memoryState = memoryCount > 0 ? `available (${memoryCount} entries)` : "available (empty)";
    const syncState = navigator.onLine ? "synced/pending sync (online)" : "offline cache only";
    const userLabel = profile?.full_name || "President";
    return [
      `System is ${online}.`,
      `Logged in user: ${userLabel} (${userId}).`,
      `Available modules: ${modules.join(", ")}.`,
      `Gmail: ${gmail.connected ? "connected" : "not connected"} (${gmail.mode}).`,
      `Local memory: ${memoryState}.`,
      `Chats: ${chatCount} conversation(s).`,
      `Sync state: ${syncState}.`,
      `Pico Claw: ${picoState}.`
    ].join(" ");
  }

  private async getActiveConversationId() {
    const setting = await db.settings.get(this.settingId(this.activeConversationSettingKey));
    return setting?.value ?? null;
  }

  private async setActiveConversation(conversationId: string) {
    await db.settings.put({
      id: this.settingId(this.activeConversationSettingKey),
      user_id: this.currentUserId ?? "anonymous",
      key: this.activeConversationSettingKey,
      value: conversationId,
      updated_at: nowIso()
    });
    this.invalidateSnapshot();
  }

  async createConversation(userId: string, title = "New Chat") {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      user_id: userId,
      title,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_message_at: nowIso()
    };
    await db.conversations.put(conversation);
    await this.setActiveConversation(conversation.id);
    await this.addMessage({
      conversationId: conversation.id,
      role: "secretary_phi",
      type: "assistant",
      content: `${SECRETARY_NAME} is ready. How can I help today?`
    });
    return conversation;
  }

  private async ensureActiveConversation(userId: string) {
    const activeConversationId = await this.getActiveConversationId();
    if (activeConversationId) {
      const existing = await db.conversations.get(activeConversationId);
      if (existing) {
        return existing.id;
      }
    }

    const existingForUser = await db.conversations
      .where("user_id")
      .equals(userId)
      .sortBy("last_message_at");
    if (existingForUser.length > 0) {
      const latestConversation = existingForUser[existingForUser.length - 1];
      if (latestConversation) {
        await this.setActiveConversation(latestConversation.id);
        return latestConversation.id;
      }
    }

    const conversation = await this.createConversation(userId, "New Chat");
    return conversation.id;
  }

  async selectConversation(conversationId: string) {
    await this.setActiveConversation(conversationId);
  }

  private async resolveConversationId(preferredId: string) {
    if (preferredId) {
      const existing = await db.conversations.get(preferredId);
      if (existing) {
        return existing.id;
      }
    }
    const active = await this.getActiveConversationId();
    if (active) {
      return active;
    }
    const fallback = await db.conversations.orderBy("updated_at").reverse().first();
    if (fallback) {
      return fallback.id;
    }
    throw new Error("No conversation available.");
  }

  private async logTimeline(eventType: string, description: string, projectId: string | null) {
    await db.timeline.put({
      id: crypto.randomUUID(),
      event_type: eventType,
      description,
      project_id: projectId,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    this.invalidateSnapshot();
  }

  private async createProject(userId: string, name: string, description = "") {
    const project: Project = {
      id: crypto.randomUUID(),
      owner_id: userId,
      name,
      description,
      status: "active",
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.projects.put(project);
    await this.logTimeline("project_created", `Project created: ${project.name}`, project.id);
    return project;
  }

  private async createTask(input: {
    title: string;
    description?: string;
    project_id?: string | null;
    requires_approval?: boolean;
    priority?: Task["priority"];
  }) {
    const task: Task = {
      id: crypto.randomUUID(),
      project_id: input.project_id ?? null,
      title: input.title,
      description: input.description ?? "",
      status: input.requires_approval ? "blocked" : "todo",
      priority: input.priority ?? "medium",
      requires_approval: input.requires_approval ?? false,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.tasks.put(task);
    await this.logTimeline("task_created", `Task created: ${task.title}`, task.project_id);
    return task;
  }

  private async createContact(name: string, email: string, projectId: string | null = null) {
    const contact: Contact = {
      id: crypto.randomUUID(),
      name,
      company: "",
      email,
      phone: "",
      notes: "",
      project_id: projectId,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.contacts.put(contact);
    await this.logTimeline("contact_created", `Contact added: ${name}`, projectId);
    return contact;
  }

  private async createNote(userId: string, title: string, content: string, projectId: string | null) {
    const note: Note = {
      id: crypto.randomUUID(),
      user_id: userId,
      title,
      content,
      project_id: projectId,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.notes.put(note);
    await this.logTimeline("note_created", `Note created: ${title}`, projectId);
    return note;
  }

  async remember(
    userId: string,
    key: string,
    value: string,
    category = "general",
    source = "secretary_phi"
  ) {
    const normalizedKey = normalizeMemoryKey(key);
    const rows = await db.memory.where("user_id").equals(userId).toArray();
    const existing = rows.find((row) => row.key === normalizedKey);

    const timestamp = nowIso();
    await db.memory.put({
      id: existing?.id ?? crypto.randomUUID(),
      user_id: userId,
      key: normalizedKey,
      value,
      category,
      source,
      created_at: existing?.created_at ?? timestamp,
      updated_at: timestamp
    });
    await this.logTimeline("memory_saved", `Memory saved for "${key}"`, null);
  }

  async searchMemory(userId: string, query: string) {
    const rows = await db.memory.where("user_id").equals(userId).toArray();
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const q = normalizeMemoryKey(query);
    const exactKey = rows.filter((item) => item.key === q);
    if (exactKey.length > 0) {
      return exactKey;
    }
    return rows.filter(
      (item) => item.key.toLowerCase().includes(q) || item.value.toLowerCase().includes(q)
    );
  }

  private async createApproval(actionType: string, payload: Record<string, unknown>) {
    const approval: Approval = {
      id: crypto.randomUUID(),
      action_type: actionType,
      payload,
      status: "pending",
      created_at: nowIso(),
      approved_at: null,
      updated_at: nowIso()
    };
    await db.approvals.put(approval);
    await this.logTimeline("approval_requested", `Approval requested: ${actionType}`, null);
    return approval;
  }

  private async sendEmail(payload: SendEmailApprovalPayload) {
    const primaryRecipient = payload.to[0];
    const response = await fetch(`${relayBaseUrl}/send/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: primaryRecipient,
        subject: payload.subject,
        body: payload.body
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Relay send failure (${response.status}): ${text}`);
    }

    const relayResult = (await response.json()) as {
      ok: boolean;
      id?: string;
      mode?: string;
      detail?: string;
    };

    await this.logTimeline(
      "email_sent",
      `Email sent to ${primaryRecipient} (${relayResult.mode ?? "unknown"} mode)`,
      null
    );
    return relayResult;
  }

  private async searchWeb(
    query: string
  ): Promise<{ ok: true; data: PublicWebSearchResult } | { ok: false; error: string }> {
    try {
      const result = await runPublicWebSearch(query);
      return {
        ok: true,
        data: result
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Web search request failed."
      };
    }
  }

  private async buildWebSearchSecretaryAnswer(
    question: string,
    fallbackAnswer: string,
    payload: PublicWebSearchResult
  ) {
    const sources = (payload.sources ?? []).slice(0, 4);
    const images = (payload.images ?? []).slice(0, 4);
    const warnings = (payload.warnings ?? []).filter((warning) => warning.trim().length > 0);

    const synthesized = await phiSynthesizeSearchAnswer({
      question,
      answerHint: cleanSnippet(payload.answer_hint ?? "") || cleanSnippet(fallbackAnswer),
      keyFacts: (payload.key_facts ?? []).map((fact) => cleanSnippet(fact)).filter(Boolean),
      sources: sources.map((source) => ({
        ...source,
        snippet: cleanSnippet(source.snippet)
      })),
      warnings
    });

    const response = [
      synthesized,
      warnings.length > 0
        ? `\nNote: live retrieval had partial issues (${warnings.join(" | ")}), so verify critical facts in the source links below.`
        : ""
    ]
      .join("\n")
      .trim();

    return {
      response,
      details: {
        search_query: payload.query ?? question,
        search_fetched_at: payload.fetched_at ?? nowIso(),
        sources,
        images
      }
    };
  }

  private isLowQualityAnswer(question: string, answer: string) {
    const normalized = answer.trim();
    if (normalized.length < 60) {
      return true;
    }
    if (fillerPatterns.some((pattern) => pattern.test(normalized))) {
      return true;
    }
    const questionTokens = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3);
    const answerLower = normalized.toLowerCase();
    const overlap = questionTokens.filter((token) => answerLower.includes(token)).length;
    if (questionTokens.length >= 2 && overlap === 0) {
      return true;
    }
    return false;
  }

  private async ensureDirectAnswerQuality(question: string, candidate: string) {
    if (!this.isLowQualityAnswer(question, candidate)) {
      return {
        answer: candidate,
        repaired: false
      };
    }

    const repaired = await phiDirectAnswer(question);
    if (!this.isLowQualityAnswer(question, repaired)) {
      return {
        answer: repaired,
        repaired: true
      };
    }

    return {
      answer: candidate,
      repaired: false
    };
  }

  async approve(approvalId: string, conversationId: string): Promise<ActionResult> {
    const resolvedConversationId = await this.resolveConversationId(conversationId);
    const approval = await db.approvals.get(approvalId);
    if (!approval || approval.status !== "pending") {
      await this.addSecretaryFinalMessage(
        resolvedConversationId,
        "error_failure",
        "I reviewed that approval, but it is no longer pending."
      );
      return {
        ok: false,
        kind: "gmail_send_failed",
        message: "Approval is no longer pending."
      };
    }

    if (approval.action_type === "send_email") {
      const gmailStatus = await this.getGmailStatus();
      if (!gmailStatus.connected) {
        const connectUrl = await this.getGmailConnectUrl();
        await this.addMessage({
          conversationId: resolvedConversationId,
          role: "manager_pico",
          type: "gmail_connection_required_card",
          content: "Gmail connection required before approval can send email.",
          payload: {
            status: gmailStatus.detail
          }
        });
        await this.logTimeline(
          "gmail_connection_required",
          "Approval blocked: Gmail is not connected.",
          null
        );
        await this.addSecretaryFinalMessage(
          resolvedConversationId,
          "approval_required",
          "Gmail is not connected yet. Please connect Gmail, then approve again."
        );
        return {
          ok: false,
          kind: "gmail_not_connected",
          message: "Gmail not connected. Connect Gmail before approving send_email.",
          connectUrl
        };
      }

      const payload = parseSendEmailPayload(approval);
      if (!payload) {
        throw new Error("Invalid send_email approval payload.");
      }
      try {
        await this.sendEmail(payload);
      } catch (error) {
        await this.addMessage({
          conversationId: resolvedConversationId,
          role: "manager_pico",
          type: "system_notice",
          content: `Email send failed: ${error instanceof Error ? error.message : "unknown error"}`
        });
        await this.logTimeline("email_send_failed", "Email send failed after approval attempt.", null);
        await this.addSecretaryFinalMessage(
          resolvedConversationId,
          "error_failure",
          "I tried to send the email, but it failed. Please retry after checking the relay/Gmail status."
        );
        return {
          ok: false,
          kind: "gmail_send_failed",
          message: error instanceof Error ? error.message : "Email send failed."
        };
      }

      approval.status = "approved";
      approval.approved_at = nowIso();
      approval.updated_at = nowIso();
      await db.approvals.put(approval);

      if (payload.task_id) {
        const task = await db.tasks.get(payload.task_id);
        if (task) {
          task.status = "done";
          task.updated_at = nowIso();
          await db.tasks.put(task);
        }
      }

      await this.addMessage({
        conversationId: resolvedConversationId,
        role: "manager_pico",
        type: "gmail_connected_status_card",
        content: "Gmail send succeeded after approval.",
        payload: {
          approval_id: approval.id
        }
      });
      await this.logTimeline("approval_granted", `Approval granted: ${approval.action_type}`, null);
      this.invalidateSnapshot();
      await this.addSecretaryFinalMessage(
        resolvedConversationId,
        "action_completed",
        "Approval completed and email sent successfully."
      );
      return {
        ok: true,
        kind: "gmail_send_success",
        message: "Email sent successfully."
      };
    }

    approval.status = "approved";
    approval.approved_at = nowIso();
    approval.updated_at = nowIso();
    await db.approvals.put(approval);

    if (approval.action_type === "create_task") {
      const payload = parseCreateTaskPayload(approval);
      if (!payload) {
        throw new Error("Invalid create_task approval payload.");
      }
      await this.createTask({
        title: payload.title,
        description: payload.description,
        requires_approval: false
      });
    }

    if (approval.action_type === "contact_subcontractor") {
      const payload = parseContactPayload(approval);
      if (!payload) {
        throw new Error("Invalid contact_subcontractor approval payload.");
      }
      await this.createContact(payload.name, payload.email, null);
    }

    await this.logTimeline("approval_granted", `Approval granted: ${approval.action_type}`, null);
    await this.addMessage({
      conversationId: resolvedConversationId,
      role: "manager_pico",
      type: "system_notice",
      content: `${MANAGER_NAME} executed approved action: ${approval.action_type}.`
    });
    this.invalidateSnapshot();
    await this.addSecretaryFinalMessage(
      resolvedConversationId,
      "action_completed",
      `Approval completed for ${approval.action_type}.`
    );
    return {
      ok: true,
      kind: "approved",
      message: `Approved ${approval.action_type}.`
    };
  }

  async reject(approvalId: string, conversationId: string): Promise<ActionResult> {
    const resolvedConversationId = await this.resolveConversationId(conversationId);
    const approval = await db.approvals.get(approvalId);
    if (!approval || approval.status !== "pending") {
      await this.addSecretaryFinalMessage(
        resolvedConversationId,
        "error_failure",
        "I checked that approval, but it is no longer pending."
      );
      return {
        ok: false,
        kind: "rejected",
        message: "Approval is no longer pending."
      };
    }
    approval.status = "rejected";
    approval.updated_at = nowIso();
    await db.approvals.put(approval);
    await this.logTimeline("approval_rejected", `Approval rejected: ${approval.action_type}`, null);
    await this.addMessage({
      conversationId: resolvedConversationId,
      role: "manager_pico",
      type: "system_notice",
      content: `${MANAGER_NAME} rejected action: ${approval.action_type}.`
    });
    this.invalidateSnapshot();
    await this.addSecretaryFinalMessage(
      resolvedConversationId,
      "action_completed",
      `I rejected ${approval.action_type} as requested.`
    );
    return {
      ok: true,
      kind: "rejected",
      message: `Rejected ${approval.action_type}.`
    };
  }

  async executeSecretaryCommand(userId: string, conversationId: string, command: string) {
    await this.addMessage({
      conversationId,
      role: "president",
      type: "user",
      content: command
    });

    const conversation = await db.conversations.get(conversationId);
    if (conversation && conversation.title === "New Chat") {
      conversation.title = command.slice(0, 42);
      conversation.updated_at = nowIso();
      conversation.last_message_at = nowIso();
      await db.conversations.put(conversation);
    }

    const phiResult = await phiLLM(command);
    const forcedMemorySave = parseMemorySaveFromCommand(command);
    const forcedMemoryRecall = parseMemoryRecallFromCommand(command);
    const effectiveIntent =
      phiResult.intent === "general" && forcedMemorySave
        ? "memory_save"
        : phiResult.intent === "general" && forcedMemoryRecall
          ? "memory_recall"
          : phiResult.intent;
    const phiDebug = getLastPhiDebugMeta();
    const debug: CommandDebugInfo = {
      intent: effectiveIntent,
      route: "direct_conversational",
      search_used: false,
      pico_used: false,
      memory_used: false,
      fallback_triggered: phiDebug.usedWeakRepair || phiDebug.mode === "heuristic",
      quality_guard_triggered: false,
      at: nowIso()
    };

    let outcome: CommandOutcome = {
      type: "action_completed",
      ok: true,
      summary: "Pico Claw organized next steps."
    };

    try {
      if (effectiveIntent === "status_query" || isStatusRequest(command)) {
        debug.route = "status_query";
        const statusSummary = await this.getSystemStatusSummary(userId);
        await this.logTimeline("status_checked", "System status requested by President.", null);
        outcome = {
          type: "informational_answer",
          ok: true,
          summary: statusSummary
        };
      } else {
        switch (effectiveIntent) {
          case "project_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            const projectName = safeText(phiResult.project_name, "Untitled Project");
            const project = await this.createProject(userId, projectName, phiResult.summary);
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "project_created_card",
              content: "Project created.",
              payload: {
                id: project.id,
                name: project.name,
                status: project.status
              }
            });
            outcome = {
              type: "project_created",
              ok: true,
              summary: `Created project "${project.name}" with status ${project.status}.`,
              details: { projectId: project.id }
            };
            break;
          }
          case "task_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            const taskTitle = safeText(phiResult.task_title, "New Task");
            if (phiResult.requires_approval) {
              const approval = await this.createApproval("create_task", {
                title: taskTitle,
                description: phiResult.summary
              });
              await this.logTimeline(
                "approval_requested",
                `Task "${taskTitle}" queued for approval.`,
                null
              );
              await this.addMessage({
                conversationId,
                role: "manager_pico",
                type: "approval_request_card",
                content: "Approval required before creating this task.",
                payload: {
                  approval_id: approval.id,
                  action_type: approval.action_type
                }
              });
              outcome = {
                type: "approval_required",
                ok: true,
                summary: `Task "${taskTitle}" is queued for approval.`,
                details: { approvalId: approval.id }
              };
            } else {
              const task = await this.createTask({
                title: taskTitle,
                description: phiResult.summary
              });
              await this.addMessage({
                conversationId,
                role: "manager_pico",
                type: "task_created_card",
                content: "Task created.",
                payload: {
                  id: task.id,
                  title: task.title,
                  status: task.status
                }
              });
              outcome = {
                type: "task_created",
                ok: true,
                summary: `Created task "${task.title}" with status ${task.status}.`,
                details: { taskId: task.id }
              };
            }
            break;
          }
          case "contact_request":
          case "approval_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            const contactName = safeText(phiResult.contact_name, "New Contact");
            const contactEmail = safeText(phiResult.contact_email, "contact@example.com");
            if (phiResult.requires_approval) {
              const approval = await this.createApproval("contact_subcontractor", {
                name: contactName,
                email: contactEmail
              });
              await this.logTimeline(
                "approval_requested",
                `Contact "${contactName}" queued for approval.`,
                null
              );
              await this.addMessage({
                conversationId,
                role: "manager_pico",
                type: "approval_request_card",
                content: "Approval required before contacting subcontractor.",
                payload: {
                  approval_id: approval.id,
                  action_type: approval.action_type
                }
              });
              outcome = {
                type: "approval_required",
                ok: true,
                summary: `Contact outreach for "${contactName}" is queued for approval.`,
                details: { approvalId: approval.id }
              };
            } else {
              const contact = await this.createContact(contactName, contactEmail);
              await this.addMessage({
                conversationId,
                role: "manager_pico",
                type: "system_notice",
                content: `Contact created: ${contact.name}`
              });
              outcome = {
                type: "action_completed",
                ok: true,
                summary: `Contact "${contact.name}" has been saved.`
              };
            }
            break;
          }
          case "note_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            const note = await this.createNote(
              userId,
              safeText(phiResult.note_title, "President Note"),
              safeText(phiResult.note_content, command),
              null
            );
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "note_saved_card",
              content: "Note saved.",
              payload: {
                id: note.id,
                title: note.title
              }
            });
            outcome = {
              type: "action_completed",
              ok: true,
              summary: `Saved note "${note.title}".`
            };
            break;
          }
          case "memory_save": {
            debug.route = "memory_save";
            debug.memory_used = true;
            const key = safeText(phiResult.memory_key, forcedMemorySave?.key ?? "note");
            const value = safeText(phiResult.memory_value, forcedMemorySave?.value ?? command);
            await this.remember(userId, key, value, "preference", "secretary_phi");
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "memory_saved_card",
              content: `Memory saved: ${key}.`,
              payload: { key, value }
            });
            outcome = {
              type: "memory_saved",
              ok: true,
              summary: `Stored memory "${key}" as "${value}".`
            };
            break;
          }
          case "memory_recall": {
            debug.route = "memory_recall";
            debug.memory_used = true;
            const query = safeText(phiResult.memory_query, forcedMemoryRecall ?? command);
            const matches = await this.searchMemory(userId, query);
            if (matches.length > 0) {
              const exact = matches.find((item) => item.key === query) ?? matches[0];
              outcome = {
                type: "informational_answer",
                ok: true,
                summary: `Your ${exact.key} is ${exact.value}.`,
                details: {
                  key: exact.key,
                  value: exact.value
                }
              };
            } else {
              outcome = {
                type: "informational_answer",
                ok: true,
                summary: "I do not have that stored yet."
              };
            }
            await this.logTimeline(
              "memory_search",
              `Memory recall attempted for query "${query}".`,
              null
            );
            break;
          }
          case "integration_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            if (phiResult.action && phiResult.action !== "send_email") {
              await this.addMessage({
                conversationId,
                role: "manager_pico",
                type: "system_notice",
                content: `${MANAGER_NAME} prepared integration action: ${phiResult.action}.`
              });
              outcome = {
                type: "action_completed",
                ok: true,
                summary: `Integration action "${phiResult.action}" is prepared.`
              };
              break;
            }
            const to = phiResult.email_to ?? [];
            let subject = phiResult.email_subject;
            let body = phiResult.email_body;
            if (!subject || !body) {
              const draft = await phiLLM(
                `Draft a short executive email for this request. Request: ${command}`
              );
              subject = subject ?? draft.email_subject ?? "AJAWAI Request";
              body =
                body ??
                draft.email_body ??
                "Hello, this is a message from AJAWAI. Please reply with your availability.";
            }

            const task = await this.createTask({
              title: safeText(phiResult.task_title, "Send approval-controlled email"),
              description: `Draft prepared by ${SECRETARY_NAME}.`,
              requires_approval: true,
              priority: "high"
            });

            const approval = await this.createApproval("send_email", {
              to: to.length > 0 ? to : ["recipient@example.com"],
              subject,
              body,
              task_id: task.id
            });

            await this.logTimeline(
              "email_drafted",
              "Secretary drafted email and queued approval.",
              null
            );
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "approval_request_card",
              content: "Email queued. Approval required before sending.",
              payload: {
                approval_id: approval.id,
                to: to.length > 0 ? to : ["recipient@example.com"],
                subject
              }
            });
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "system_notice",
              content: `${MANAGER_NAME} organized next steps and queued email for approval.`
            });
            outcome = {
              type: "approval_required",
              ok: true,
              summary: "Email draft is ready and queued for approval.",
              details: { approvalId: approval.id, taskId: task.id }
            };
            break;
          }
          case "external_action_request": {
            debug.route = "pico_operational";
            debug.pico_used = true;
            await this.addMessage({
              conversationId,
              role: "manager_pico",
              type: "system_notice",
              content: `${MANAGER_NAME} prepared external-agent execution path.`
            });
            outcome = {
              type: "approval_required",
              ok: true,
              summary:
                "External operation is prepared. I can proceed when you confirm execution details."
            };
            break;
          }
          case "conversational": {
            debug.route = "direct_conversational";
            if (phiResult.needs_web_search) {
              debug.route = "search_assisted_conversational";
              debug.search_used = true;
              const searchQuery = safeText(phiResult.web_search_query, command);
              const webResult = await this.searchWeb(searchQuery);
              if (webResult.ok) {
                const { response, details } = await this.buildWebSearchSecretaryAnswer(
                  command,
                  phiResult.response,
                  webResult.data
                );
                await this.logTimeline("web_search_completed", `Live web search completed for "${searchQuery}".`, null);
                outcome = {
                  type: "informational_answer",
                  ok: true,
                  summary: response,
                  details
                };
                break;
              }

              await this.logTimeline(
                "web_search_failed",
                `Web search failed for "${searchQuery}": ${webResult.error ?? "unknown error"}`,
                null
              );
              outcome = {
                type: "informational_answer",
                ok: true,
                summary: `${phiResult.response}\n\nI could not reach live web search just now, so this answer may not include the latest updates.`,
                details: {
                  search_query: searchQuery,
                  search_error: webResult.error ?? "Web search unavailable"
                }
              };
              break;
            }

            outcome = {
              type: "informational_answer",
              ok: true,
              summary: phiResult.response
            };
            break;
          }
          default: {
            debug.route = "direct_conversational";
            await this.logTimeline("command_interpreted", phiResult.summary, null);
            outcome = {
              type: "informational_answer",
              ok: true,
              summary: safeText(
                phiResult.response,
                "I could not complete that as an operation yet, but I can help if you share the specific result you want."
              )
            };
          }
        }
      }

      await this.remember(userId, "last_command", command, "telemetry", "system");
    } catch (error) {
      outcome = {
        type: "error_failure",
        ok: false,
        summary:
          error instanceof Error
            ? error.message
            : "I reviewed the request, but I need more information."
      };
      await this.addMessage({
        conversationId,
        role: "manager_pico",
        type: "system_notice",
        content: `${MANAGER_NAME} encountered an execution issue.`
      });
      await this.logTimeline(
        "execution_error",
        `Execution failure: ${outcome.summary}`,
        null
      );
    }

    let finalResponse = this.buildSecretaryFinalResponse(outcome);
    if (debug.route === "direct_conversational" || debug.route === "search_assisted_conversational") {
      const guarded = await this.ensureDirectAnswerQuality(command, finalResponse);
      finalResponse = guarded.answer;
      debug.quality_guard_triggered = guarded.repaired;
    }
    await this.addSecretaryFinalMessage(conversationId, outcome.type, finalResponse, outcome.details);
    this.invalidateSnapshot();
    return {
      ...phiResult,
      response: finalResponse,
      debug
    };
  }

  async createProjectFromForm(userId: string, name: string, description: string) {
    await this.createProject(userId, name, description);
    this.invalidateSnapshot();
  }

  async createTaskFromForm(title: string, description: string, priority: Task["priority"]) {
    await this.createTask({ title, description, priority });
    this.invalidateSnapshot();
  }

  async setTaskStatus(taskId: string, status: Task["status"]) {
    const task = await db.tasks.get(taskId);
    if (!task) {
      return;
    }
    task.status = status;
    task.updated_at = nowIso();
    await db.tasks.put(task);
    await this.logTimeline("task_updated", `Task "${task.title}" moved to ${status}.`, task.project_id);
    this.invalidateSnapshot();
  }

  async createNoteFromForm(userId: string, title: string, content: string) {
    await this.createNote(userId, title, content, null);
    this.invalidateSnapshot();
  }

  async createContactFromForm(input: { name: string; email: string; company?: string; phone?: string }) {
    const contact: Contact = {
      id: crypto.randomUUID(),
      name: input.name,
      company: input.company ?? "",
      email: input.email,
      phone: input.phone ?? "",
      notes: "",
      project_id: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    await db.contacts.put(contact);
    await this.logTimeline("contact_created", `Contact added: ${input.name}`, null);
    this.invalidateSnapshot();
  }

  async getGmailStatus(): Promise<GmailStatus> {
    try {
      const response = await fetch(`${relayBaseUrl}/gmail/status`);
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const payload = (await response.json()) as GmailStatus;
      return payload;
    } catch {
      return {
        connected: false,
        mode: "stub",
        detail: "Relay unreachable. Offline mode active."
      };
    }
  }

  async getGmailConnectUrl() {
    try {
      const response = await fetch(`${relayBaseUrl}/gmail/connect-url`);
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const payload = (await response.json()) as { connect_url?: string };
      return payload.connect_url ?? null;
    } catch {
      return null;
    }
  }
}

export const picoClawManager = new PicoClawManager();
