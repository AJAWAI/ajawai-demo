import type {
  Approval,
  Contact,
  Note,
  PhiResponse,
  Profile,
  Project,
  Task,
  Timeline
} from "@ajawai/shared";
import { db, nowIso, type AgentMessage, type MemoryEntry } from "../storage/db";
import { localCache } from "../storage/cache";
import { MANAGER_NAME, SECRETARY_NAME } from "../constants/module3";
import { phiLLM } from "./phi";

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

export interface Module3Snapshot {
  profiles: Profile[];
  projects: Project[];
  tasks: Task[];
  contacts: Contact[];
  notes: Note[];
  approvals: Approval[];
  timeline: Timeline[];
  memory: MemoryEntry[];
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

export class PicoClawManager {
  async bootstrap(userId: string) {
    const existing = await db.profiles.where("user_id").equals(userId).first();
    if (existing) {
      return existing;
    }

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
    return profile;
  }

  async getSnapshot(): Promise<Module3Snapshot> {
    const cached = localCache.get<Module3Snapshot>("module3:snapshot");
    if (cached) {
      return cached;
    }

    const snapshot: Module3Snapshot = {
      profiles: await db.profiles.orderBy("updated_at").reverse().toArray(),
      projects: await db.projects.orderBy("updated_at").reverse().toArray(),
      tasks: await db.tasks.orderBy("updated_at").reverse().toArray(),
      contacts: await db.contacts.orderBy("updated_at").reverse().toArray(),
      notes: await db.notes.orderBy("updated_at").reverse().toArray(),
      approvals: await db.approvals.orderBy("updated_at").reverse().toArray(),
      timeline: await db.timeline.orderBy("updated_at").reverse().toArray(),
      memory: await db.memory.orderBy("updated_at").reverse().toArray(),
      messages: await db.messages.orderBy("created_at").reverse().toArray()
    };
    localCache.set("module3:snapshot", snapshot, 10_000);
    return snapshot;
  }

  private invalidateSnapshot() {
    localCache.invalidate("module3:snapshot");
  }

  private async addMessage(role: AgentMessage["role"], content: string) {
    await db.messages.put({
      id: crypto.randomUUID(),
      role,
      content,
      created_at: nowIso()
    });
    this.invalidateSnapshot();
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

  async remember(key: string, value: string) {
    await db.memory.put({
      id: crypto.randomUUID(),
      key,
      value,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    await this.logTimeline("memory_saved", `Memory saved for "${key}"`, null);
  }

  async searchMemory(query: string) {
    const rows = await db.memory.orderBy("updated_at").reverse().toArray();
    const q = query.toLowerCase();
    return rows.filter((item) => item.key.toLowerCase().includes(q) || item.value.toLowerCase().includes(q));
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

  async approve(approvalId: string) {
    const approval = await db.approvals.get(approvalId);
    if (!approval || approval.status !== "pending") {
      return;
    }

    approval.status = "approved";
    approval.approved_at = nowIso();
    approval.updated_at = nowIso();
    await db.approvals.put(approval);

    if (approval.action_type === "send_email") {
      const payload = parseSendEmailPayload(approval);
      if (!payload) {
        throw new Error("Invalid send_email approval payload.");
      }
      await this.sendEmail(payload);
      if (payload.task_id) {
        const task = await db.tasks.get(payload.task_id);
        if (task) {
          task.status = "done";
          task.updated_at = nowIso();
          await db.tasks.put(task);
        }
      }
    }

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
    await this.addMessage("manager_pico", `${MANAGER_NAME} executed approved action: ${approval.action_type}.`);
    this.invalidateSnapshot();
  }

  async reject(approvalId: string) {
    const approval = await db.approvals.get(approvalId);
    if (!approval || approval.status !== "pending") {
      return;
    }
    approval.status = "rejected";
    approval.updated_at = nowIso();
    await db.approvals.put(approval);
    await this.logTimeline("approval_rejected", `Approval rejected: ${approval.action_type}`, null);
    this.invalidateSnapshot();
  }

  async executeSecretaryCommand(userId: string, command: string) {
    await this.addMessage("president", command);

    const phiResult = await phiLLM(command);
    await this.addMessage("secretary_phi", phiResult.response);

    switch (phiResult.intent) {
      case "create_project": {
        const projectName = safeText(phiResult.project_name, "Untitled Project");
        await this.createProject(userId, projectName, phiResult.summary);
        break;
      }
      case "create_task": {
        const taskTitle = safeText(phiResult.task_title, "New Task");
        if (phiResult.requires_approval) {
          await this.createApproval("create_task", {
            title: taskTitle,
            description: phiResult.summary
          });
          await this.logTimeline(
            "approval_requested",
            `Task "${taskTitle}" queued for approval.`,
            null
          );
        } else {
          await this.createTask({
            title: taskTitle,
            description: phiResult.summary
          });
        }
        break;
      }
      case "create_contact": {
        const contactName = safeText(phiResult.contact_name, "New Contact");
        const contactEmail = safeText(phiResult.contact_email, "contact@example.com");
        if (phiResult.requires_approval) {
          await this.createApproval("contact_subcontractor", {
            name: contactName,
            email: contactEmail
          });
          await this.logTimeline(
            "approval_requested",
            `Contact "${contactName}" queued for approval.`,
            null
          );
        } else {
          await this.createContact(contactName, contactEmail);
        }
        break;
      }
      case "create_note": {
        await this.createNote(
          userId,
          safeText(phiResult.note_title, "President Note"),
          safeText(phiResult.note_content, command),
          null
        );
        break;
      }
      case "search_memory": {
        const query = safeText(phiResult.memory_query, command);
        const matches = await this.searchMemory(query);
        const summary = matches.length
          ? `Found ${matches.length} memory item(s) for "${query}".`
          : `No memory matches for "${query}" yet.`;
        await this.addMessage("secretary_phi", summary);
        await this.logTimeline("memory_search", summary, null);
        break;
      }
      case "send_email": {
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

        await this.createApproval("send_email", {
          to: to.length > 0 ? to : ["recipient@example.com"],
          subject,
          body,
          task_id: task.id
        });

        await this.logTimeline("email_drafted", "Secretary drafted email and queued approval.", null);
        break;
      }
      default: {
        await this.logTimeline("command_interpreted", phiResult.summary, null);
      }
    }

    await this.remember("last_command", command);
    this.invalidateSnapshot();
    return phiResult;
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
