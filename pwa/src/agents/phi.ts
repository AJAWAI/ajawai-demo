import { phiResponseSchema, type PhiResponse } from "@ajawai/shared";
import { LOCAL_PHI_MODEL, SECRETARY_NAME } from "../constants/module3";

type RuntimeState = "initializing" | "ready" | "fallback";

type GeneratorOutput = Array<{ generated_text?: string }>;
type GeneratorFn = (
  prompt: string,
  options?: Record<string, unknown>
) => Promise<GeneratorOutput>;

const now = () => new Date().toISOString();

let generatorPromise: Promise<GeneratorFn | null> | null = null;
let runtimeState: RuntimeState = "initializing";

const jsonFromText = (text: string): unknown | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
};

const normalizeMemoryKey = (raw: string) => {
  return raw
    .replace(/\?+$/, "")
    .replace(/^my\s+/i, "")
    .trim()
    .toLowerCase();
};

const parseMemorySave = (input: string): { key: string; value: string } | null => {
  const explicit = input.match(/(?:store|save)\s+memory:\s*(.+)$/i);
  const remember = input.match(/remember(?:\s+that|\s+this)?[:\s]+(.+)$/i);
  const statement = explicit?.[1] ?? remember?.[1];
  if (!statement) {
    return null;
  }
  const keyValueMatch = statement.match(/^(.+?)\s+is\s+(.+)$/i);
  if (keyValueMatch) {
    const key = normalizeMemoryKey(keyValueMatch[1]);
    const value = keyValueMatch[2].trim().replace(/\.$/, "");
    if (key && value) {
      return { key, value };
    }
  }
  return {
    key: "note",
    value: statement.trim().replace(/\.$/, "")
  };
};

const parseMemoryRecall = (input: string): string | null => {
  const trimmed = input.trim();
  const patterns = [
    /what is my (.+)\??$/i,
    /what's my (.+)\??$/i,
    /what do you know about (.+)\??$/i,
    /do you remember (.+)\??$/i,
    /recall (.+)\??$/i,
    /tell me about (.+)\??$/i
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return normalizeMemoryKey(match[1]);
    }
  }
  if (trimmed.toLowerCase().includes("memory")) {
    return normalizeMemoryKey(trimmed);
  }
  return null;
};

const heuristicPhi = (prompt: string): PhiResponse => {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();
  const emailMatches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  const memorySave = parseMemorySave(normalized);
  if (memorySave) {
    return phiResponseSchema.parse({
      intent: "save_memory",
      summary: "Memory save intent identified.",
      response: `${SECRETARY_NAME} is storing this memory now.`,
      requires_approval: false,
      memory_key: memorySave.key,
      memory_value: memorySave.value
    });
  }

  const memoryRecall = parseMemoryRecall(normalized);
  if (memoryRecall) {
    return phiResponseSchema.parse({
      intent: "recall_memory",
      summary: "Memory recall intent identified.",
      response: `${SECRETARY_NAME} is checking memory for that.`,
      requires_approval: false,
      memory_query: memoryRecall
    });
  }

  if (
    lower.includes("system status") ||
    lower.includes("confirm the system is running") ||
    lower.includes("show current system status")
  ) {
    return phiResponseSchema.parse({
      intent: "status_query",
      summary: "System status request identified.",
      response: `${SECRETARY_NAME} is gathering current system status.`,
      requires_approval: false
    });
  }

  if (lower.includes("email") || lower.includes("send")) {
    const recipients = emailMatches.length > 0 ? emailMatches : ["recipient@example.com"];
    const response = {
      intent: "send_email",
      summary: "Prepared email draft for Manager Pico Claw.",
      response: `${SECRETARY_NAME} drafted an email and queued it for approval.`,
      requires_approval: true,
      email_to: recipients,
      email_subject: "Request for quote",
      email_body:
        "Hello, we are requesting a quote for our project. Please share pricing and availability.",
      task_title: `Send outreach email to ${recipients.length} contact(s)`
    };

    return phiResponseSchema.parse(response);
  }

  if (lower.includes("project")) {
    const response = {
      intent: "create_project",
      summary: "Project intent identified.",
      response: `${SECRETARY_NAME} created a project request for Pico Claw.`,
      requires_approval: false,
      project_name: normalized.replace(/.*project\s*/i, "").trim() || "New Project"
    };
    return phiResponseSchema.parse(response);
  }

  if (lower.includes("task")) {
    const needsApproval = lower.includes("approve");
    const response = {
      intent: "create_task",
      summary: "Task intent identified.",
      response: `${SECRETARY_NAME} generated a task for Pico Claw.`,
      requires_approval: needsApproval,
      task_title: normalized.replace(/.*task\s*/i, "").trim() || "New Task"
    };
    return phiResponseSchema.parse(response);
  }

  if (lower.includes("note")) {
    const response = {
      intent: "create_note",
      summary: "Note capture intent identified.",
      response: `${SECRETARY_NAME} summarized and saved your note.`,
      requires_approval: false,
      note_title: "President Note",
      note_content: normalized
    };
    return phiResponseSchema.parse(response);
  }

  if (lower.includes("contact") || emailMatches.length > 0) {
    const needsApproval = lower.includes("subcontractor") || lower.includes("approve");
    const response = {
      intent: "create_contact",
      summary: "Contact intent identified.",
      response: `${SECRETARY_NAME} prepared a new contact entry.`,
      requires_approval: needsApproval,
      contact_name: "New Contact",
      contact_email: emailMatches[0] ?? "contact@example.com"
    };
    return phiResponseSchema.parse(response);
  }

  return phiResponseSchema.parse({
    intent: "general",
    summary: "General request interpreted.",
    response: `${SECRETARY_NAME} understood the request and asked Pico Claw to organize next steps.`,
    requires_approval: false
  });
};

const initializeLocalPhi = async (): Promise<GeneratorFn | null> => {
  if (!generatorPromise) {
    generatorPromise = (async () => {
      try {
        const transformers = (await import("@huggingface/transformers")) as unknown as {
          pipeline: (
            task: string,
            model: string,
            options?: Record<string, unknown>
          ) => Promise<GeneratorFn>;
          env: {
            useBrowserCache: boolean;
            allowRemoteModels: boolean;
          };
        };

        transformers.env.useBrowserCache = true;
        transformers.env.allowRemoteModels = true;

        try {
          const webgpuGenerator = await transformers.pipeline(
            "text-generation",
            LOCAL_PHI_MODEL,
            {
              device: "webgpu"
            }
          );
          runtimeState = "ready";
          return webgpuGenerator;
        } catch {
          const wasmGenerator = await transformers.pipeline(
            "text-generation",
            LOCAL_PHI_MODEL,
            {
              device: "wasm"
            }
          );
          runtimeState = "ready";
          return wasmGenerator;
        }
      } catch {
        runtimeState = "fallback";
        return null;
      }
    })();
  }

  return generatorPromise;
};

const buildPrompt = (prompt: string) => {
  return [
    "You are Secretary Phi in AJAWAI.",
    "Return JSON only with keys:",
    "intent, summary, response, requires_approval, project_name, task_title, note_title, note_content, contact_name, contact_email, email_to, email_subject, email_body, memory_query, memory_key, memory_value.",
    "Choose intent from create_project, create_task, create_contact, create_note, send_email, save_memory, recall_memory, status_query, general.",
    "If action sends email, set requires_approval true.",
    `User request: ${prompt}`
  ].join("\n");
};

export const getPhiRuntimeState = () => runtimeState;

export const phiLLM = async (prompt: string): Promise<PhiResponse> => {
  const generator = await initializeLocalPhi();
  if (!generator) {
    return heuristicPhi(prompt);
  }

  try {
    const output = await generator(buildPrompt(prompt), {
      max_new_tokens: 256,
      temperature: 0.2,
      return_full_text: false
    });

    const text = output[0]?.generated_text ?? "";
    const candidate = jsonFromText(text);
    const parsed = phiResponseSchema.safeParse(candidate);
    if (parsed.success) {
      return parsed.data;
    }
    return heuristicPhi(prompt);
  } catch {
    runtimeState = "fallback";
    return heuristicPhi(prompt);
  }
};

export const phiSystemStatus = () => {
  return {
    name: SECRETARY_NAME,
    runtime: runtimeState,
    model: LOCAL_PHI_MODEL,
    checked_at: now()
  };
};
