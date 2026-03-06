import { phiResponseSchema, type PhiResponse } from "@ajawai/shared";
import { LOCAL_PHI_MODEL, SECRETARY_NAME } from "../constants/module3";

type RuntimeState = "initializing" | "ready" | "fallback";
type GeneratorOutput = Array<{ generated_text?: string }>;
type GeneratorFn = (
  prompt: string,
  options?: Record<string, unknown>
) => Promise<GeneratorOutput>;
type SupportedTranslationLanguage = "spanish" | "french" | "english";

export type ResponseMode = "brief" | "standard" | "structured" | "comprehensive";

export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SearchSynthesisInput {
  question: string;
  answerHint: string;
  keyFacts: string[];
  sources: Array<{
    title: string;
    snippet: string;
    source: string;
    score?: number;
  }>;
  warnings: string[];
}

export interface PhiDebugMeta {
  mode: "heuristic" | "model" | "system_fallback";
  usedWeakRepair: boolean;
  usedSearchHeuristic: boolean;
  llmCalled: boolean;
  responseMode: ResponseMode;
  outputTruncated: boolean;
  normalizedPrompt: string;
  checkedAt: string;
}

export interface DirectAnswerOptions {
  history?: ConversationTurn[];
  memoryGuidance?: string;
  responseMode?: ResponseMode;
  toolResultContext?: string;
}

interface TranslationIntent {
  targetLanguage: SupportedTranslationLanguage;
  phrases: string[];
}

interface IntentDecision {
  intent: PhiResponse["intent"];
  summary: string;
  requiresApproval?: boolean;
  action?: string;
  projectName?: string;
  taskTitle?: string;
  noteTitle?: string;
  noteContent?: string;
  contactName?: string;
  contactEmail?: string;
  emailTo?: string[];
  emailSubject?: string;
  emailBody?: string;
  memoryQuery?: string;
  memoryKey?: string;
  memoryValue?: string;
  translationTargetLanguage?: SupportedTranslationLanguage;
  translationPhrases?: string[];
}

const now = () => new Date().toISOString();

const MODEL_RETRY_COOLDOWN_MS = 12_000;
const bannedTemplatePatterns = [
  /\bi can help with\b/i,
  /\bhere is a practical answer\b/i,
  /\bpractical .*recipe template\b/i,
  /\bstart with the core objective\b/i,
  /\bstart by defining the exact outcome\b/i,
  /\bmain ingredient\(s\)\b/i,
  /\banswer\s*:\s*/i,
  /\bi can also format it\b/i
];
const broadPromptPatterns = [
  /\bwhat is life\b/i,
  /\bconsciousness\b/i,
  /\bfuture of ai\b/i,
  /\bwhat can ai do\b/i,
  /\bhumanity\b/i,
  /\bhow should i build\b/i,
  /\bcompare these systems\b/i,
  /\bstrategy\b/i,
  /\broadly\b/i,
  /\bin depth\b/i
];
const structuredPromptPatterns = [
  /\brecipe\b/i,
  /\bhow to make\b/i,
  /\bcompare\b/i,
  /\bproposal\b/i,
  /\bplan\b/i,
  /\banalyze\b/i,
  /\banalysis\b/i,
  /\broadmap\b/i
];
const briefPromptPatterns = [
  /\bbrief\b/i,
  /\bshort answer\b/i,
  /\bin one sentence\b/i,
  /\bconcise\b/i
];
const currentInfoPatterns = [
  /\bnet worth\b/i,
  /\bbillionaire\b/i,
  /\bcurrent\b/i,
  /\blatest\b/i,
  /\bnews\b/i,
  /\btoday\b/i,
  /\bnow\b/i,
  /\brichest\b/i,
  /\bprice\b/i,
  /\bmarket cap\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  /\bthis year\b/i,
  /\branking\b/i,
  /\btop \d+\b/i
];

const translationLanguageAliases: Array<{
  alias: string;
  language: SupportedTranslationLanguage;
}> = [
  { alias: "spanish", language: "spanish" },
  { alias: "espanol", language: "spanish" },
  { alias: "español", language: "spanish" },
  { alias: "french", language: "french" },
  { alias: "francais", language: "french" },
  { alias: "français", language: "french" },
  { alias: "english", language: "english" },
  { alias: "inglés", language: "english" },
  { alias: "ingles", language: "english" }
];

let generatorPromise: Promise<GeneratorFn | null> | null = null;
let runtimeState: RuntimeState = "initializing";
let lastModelError: string | null = null;
let lastInitAttemptAt = 0;
let lastPhiDebugMeta: PhiDebugMeta = {
  mode: "heuristic",
  usedWeakRepair: false,
  usedSearchHeuristic: false,
  llmCalled: false,
  responseMode: "standard",
  outputTruncated: false,
  normalizedPrompt: "",
  checkedAt: now()
};

const markPhiDebug = (next: Partial<PhiDebugMeta>) => {
  lastPhiDebugMeta = {
    ...lastPhiDebugMeta,
    ...next,
    checkedAt: now()
  };
};

export const normalizePromptForReasoning = (input: string) => {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bwhat did you to do\b/gi, "what did you do")
    .replace(/\bhow do i self improve inspire me\b/gi, "how can I improve myself and stay inspired")
    .replace(/\bself improve\b/gi, "self-improve")
    .replace(/\bi wanna\b/gi, "I want to")
    .replace(/\bgonna\b/gi, "going to")
    .replace(/\bpls\b/gi, "please")
    .replace(/\bthx\b/gi, "thanks");
};

const sanitizeModelAnswer = (text: string) => {
  return text
    .replace(/^assistant:\s*/i, "")
    .replace(/^secretary phi:\s*/i, "")
    .replace(/^response:\s*/i, "")
    .trim();
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

const detectTargetLanguage = (prompt: string): SupportedTranslationLanguage | null => {
  const lower = prompt.toLowerCase();
  let bestMatch: { index: number; language: SupportedTranslationLanguage } | null = null;
  for (const entry of translationLanguageAliases) {
    const idx = lower.lastIndexOf(entry.alias.toLowerCase());
    if (idx >= 0 && (!bestMatch || idx > bestMatch.index)) {
      bestMatch = { index: idx, language: entry.language };
    }
  }
  return bestMatch?.language ?? null;
};

const normalizeTranslationPhrase = (value: string) => {
  return value
    .toLowerCase()
    .replace(/\bwhat did you to do\b/g, "what did you do")
    .replace(/\bhow say\b/g, "how do you say")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const splitTranslationPhrases = (input: string): string[] => {
  const chunks = input
    .replace(/\bwhat did you to do\b/gi, "what did you do")
    .replace(/\bin\?\s*/gi, "? ")
    .split(/\?|\.|;|,(?!\d)|\band\b|\&|\n/gi)
    .map((chunk) =>
      chunk
        .trim()
        .replace(/^(translate|say|how do you say|how say)\s+/i, "")
        .replace(
          /\s+(in|into|to)\s+(spanish|espanol|español|french|francais|français|english|ingles|inglés)\s*$/i,
          ""
        )
    )
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = normalizeTranslationPhrase(chunk);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(chunk.replace(/\?+$/, "").trim());
  }
  return deduped;
};

export const parseTranslationIntent = (prompt: string): TranslationIntent | null => {
  const lower = prompt.toLowerCase().trim();
  const hasTranslateSignal =
    lower.includes("translate") ||
    lower.includes("how do you say") ||
    lower.includes("how say") ||
    /\b(spanish|french|english)\s+for\b/.test(lower);
  if (!hasTranslateSignal) {
    return null;
  }
  const targetLanguage = detectTargetLanguage(prompt);
  if (!targetLanguage) {
    return null;
  }

  const languageForPattern = new RegExp(
    `\\b(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)\\s+for\\s+(.+)$`,
    "i"
  );
  const howDoYouSayPattern = new RegExp(
    `how\\s*(?:do\\s*you\\s*)?say\\s+(.+?)\\s+(?:in|into|to)\\s+(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)`,
    "i"
  );
  const translatePattern = new RegExp(
    `translate\\s+(.+?)\\s+(?:in|into|to)\\s+(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)`,
    "i"
  );
  const sourceText =
    prompt.match(languageForPattern)?.[1] ??
    prompt.match(howDoYouSayPattern)?.[1] ??
    prompt.match(translatePattern)?.[1] ??
    prompt;

  const phrases = splitTranslationPhrases(sourceText);
  if (!phrases.length) {
    return null;
  }
  return {
    targetLanguage,
    phrases
  };
};

const languageLabel = (language: SupportedTranslationLanguage) => {
  if (language === "spanish") {
    return "Spanish";
  }
  if (language === "french") {
    return "French";
  }
  return "English";
};

export const isRecipePrompt = (prompt: string) =>
  /\b(recipe|how to make|cook|bake|fry|ingredients)\b/i.test(prompt);

export const chooseResponseMode = (prompt: string): ResponseMode => {
  const normalized = normalizePromptForReasoning(prompt);
  if (briefPromptPatterns.some((pattern) => pattern.test(normalized))) {
    return "brief";
  }
  if (broadPromptPatterns.some((pattern) => pattern.test(normalized))) {
    return "comprehensive";
  }
  if (structuredPromptPatterns.some((pattern) => pattern.test(normalized))) {
    return "structured";
  }
  return "standard";
};

export const shouldUseWebSearch = (prompt: string) => {
  const normalized = normalizePromptForReasoning(prompt);
  if (normalized.length < 3) {
    return false;
  }
  if (parseTranslationIntent(normalized)) {
    return false;
  }
  const lower = normalized.toLowerCase();
  if (
    lower.includes("remember that") ||
    lower.includes("store memory") ||
    lower.includes("save memory") ||
    isRecipePrompt(normalized)
  ) {
    return false;
  }
  if (/\b(send email|create task|create project|new task|new project)\b/i.test(normalized)) {
    return false;
  }
  return currentInfoPatterns.some((pattern) => pattern.test(normalized));
};

const formatConversationContext = (history: ConversationTurn[]) => {
  if (!history.length) {
    return "No prior conversation context.";
  }
  return history
    .slice(-10)
    .map((turn) => {
      if (turn.role === "user") {
        return `User: ${turn.content}`;
      }
      if (turn.role === "assistant") {
        return `Secretary: ${turn.content}`;
      }
      return `System: ${turn.content}`;
    })
    .join("\n");
};

const getTokenBudget = (mode: ResponseMode, prompt: string) => {
  if (isRecipePrompt(prompt)) {
    return 720;
  }
  if (mode === "brief") {
    return 180;
  }
  if (mode === "comprehensive") {
    return 760;
  }
  if (mode === "structured") {
    return 620;
  }
  return 420;
};

const buildCoreSystemPrompt = (mode: ResponseMode, userPrompt: string) => {
  const recipeMode = isRecipePrompt(userPrompt);
  const modeInstruction =
    mode === "brief"
      ? "Be concise (2-5 sentences) while still directly answering the question."
      : mode === "comprehensive"
        ? "Give a deep, thoughtful, multi-paragraph answer with concrete details by default."
        : mode === "structured"
          ? "Use a clear structured format with headings and bullet points where useful."
          : "Answer directly and clearly with practical detail.";

  const recipeInstruction = recipeMode
    ? "If this is a food request, provide: recipe title, servings, ingredients with exact measurements, step-by-step method, timing, temperature where relevant, and optional substitutions/variations."
    : "Do not force a recipe format unless the user asks for food preparation.";

  return [
    `You are ${SECRETARY_NAME}, the primary executive AI assistant in AJAWAI.`,
    "You must reason directly and answer the user's actual request.",
    modeInstruction,
    recipeInstruction,
    "Strictly avoid template filler and robotic wrappers.",
    "Never output phrases like: 'I can help with...', 'Here is a practical answer...', 'Answer: <prompt>', or placeholder recipe skeleton text.",
    "Answer first. Ask follow-up questions only when information is truly missing.",
    "Do not mention internal routing, pipelines, or tool orchestration.",
    "Stay natural, polished, and high-signal."
  ].join("\n");
};

const buildLLMPrompt = (
  prompt: string,
  options: Required<Pick<DirectAnswerOptions, "history" | "memoryGuidance">> &
    Pick<DirectAnswerOptions, "toolResultContext" | "responseMode">
) => {
  return [
    buildCoreSystemPrompt(options.responseMode ?? "standard", prompt),
    `Conversation context:\n${formatConversationContext(options.history)}`,
    options.memoryGuidance
      ? `Relevant user memory context:\n${options.memoryGuidance}`
      : "Relevant user memory context: none",
    options.toolResultContext
      ? `Tool output context (already executed, synthesize for final answer):\n${options.toolResultContext}`
      : "Tool output context: none",
    `User request: ${prompt}`
  ].join("\n\n");
};

const buildSystemFailureMessage = () =>
  "I can’t access the local reasoning model right now. Please retry in a moment.";

export const isTemplateLikeReply = (reply: string) => {
  const trimmed = reply.trim();
  if (!trimmed) {
    return true;
  }
  return bannedTemplatePatterns.some((pattern) => pattern.test(trimmed));
};

export const looksLikePromptEcho = (prompt: string, response: string) => {
  const p = normalizePromptForReasoning(prompt).toLowerCase();
  const r = response.toLowerCase().trim();
  if (!r) {
    return true;
  }
  return r.startsWith(`answer: ${p}`) || r === p || r.startsWith(`${p}.`);
};

export const isRecipeQualityResponse = (response: string) => {
  const lower = response.toLowerCase();
  const hasIngredients = /ingredients/.test(lower);
  const hasSteps = /(steps|instructions|method)/.test(lower);
  const hasMeasurements = /\b(\d+\s?(cup|tbsp|tsp|g|kg|oz|ml|l|°f|°c|min|minutes|hours?|serves?))\b/i.test(
    response
  );
  const hasTiming = /\b(min|minutes|hour|hours|bake|fry|simmer|cook)\b/i.test(response);
  const hasPlaceholders =
    /\bmain ingredient\(s\)|seasoning|optional add-ons|practical .* recipe template\b/i.test(
      lower
    );
  return hasIngredients && hasSteps && hasMeasurements && hasTiming && !hasPlaceholders;
};

const isLikelyTruncated = (response: string, tokenBudget: number) => {
  const trimmed = response.trim();
  if (trimmed.length < 80) {
    return false;
  }
  const nearTokenCapByChars = trimmed.length > Math.floor(tokenBudget * 3.1 * 0.82);
  const endsAbruptly = !/[.!?)]$/.test(trimmed);
  return nearTokenCapByChars && endsAbruptly;
};

const initializeLocalPhi = async (): Promise<GeneratorFn | null> => {
  const nowMs = Date.now();
  if (runtimeState === "fallback" && nowMs - lastInitAttemptAt < MODEL_RETRY_COOLDOWN_MS) {
    return null;
  }
  if (!generatorPromise) {
    lastInitAttemptAt = nowMs;
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
          const webgpuGenerator = await transformers.pipeline("text-generation", LOCAL_PHI_MODEL, {
            device: "webgpu"
          });
          runtimeState = "ready";
          lastModelError = null;
          return webgpuGenerator;
        } catch {
          const wasmGenerator = await transformers.pipeline("text-generation", LOCAL_PHI_MODEL, {
            device: "wasm"
          });
          runtimeState = "ready";
          lastModelError = null;
          return wasmGenerator;
        }
      } catch (error) {
        runtimeState = "fallback";
        lastModelError = error instanceof Error ? error.message : "Model initialization failed.";
        return null;
      } finally {
        if (runtimeState === "fallback") {
          generatorPromise = null;
        }
      }
    })();
  }
  return generatorPromise;
};

const runModel = async (
  prompt: string,
  config: {
    maxNewTokens: number;
    temperature: number;
  }
) => {
  const generator = await initializeLocalPhi();
  if (!generator) {
    return null;
  }
  const output = await generator(prompt, {
    max_new_tokens: config.maxNewTokens,
    temperature: config.temperature,
    return_full_text: false
  });
  return sanitizeModelAnswer(output[0]?.generated_text ?? "");
};

const requiresStatusQuery = (lower: string) =>
  lower.includes("system status") ||
  lower.includes("confirm the system is running") ||
  lower.includes("show current system status");

const routeIntent = (prompt: string): IntentDecision => {
  const normalized = normalizePromptForReasoning(prompt);
  const lower = normalized.toLowerCase();
  const emailMatches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  const translationIntent = parseTranslationIntent(normalized);
  if (translationIntent) {
    return {
      intent: "translation_request",
      summary: `Translation request identified (${languageLabel(translationIntent.targetLanguage)}).`,
      translationTargetLanguage: translationIntent.targetLanguage,
      translationPhrases: translationIntent.phrases
    };
  }

  const memorySave = parseMemorySave(normalized);
  if (memorySave) {
    return {
      intent: "memory_save",
      summary: "Memory save request identified.",
      memoryKey: memorySave.key,
      memoryValue: memorySave.value
    };
  }

  const memoryRecall = parseMemoryRecall(normalized);
  if (memoryRecall) {
    return {
      intent: "memory_recall",
      summary: "Memory recall request identified.",
      memoryQuery: memoryRecall
    };
  }

  if (requiresStatusQuery(lower)) {
    return {
      intent: "status_query",
      summary: "System status request identified."
    };
  }

  const operationalEmailRequest =
    !/(draft an email|write an email|compose an email)/i.test(normalized) &&
    (/\bsend email\b/i.test(normalized) ||
      /^\s*email\s+/i.test(normalized) ||
      /\breach out\b/i.test(normalized) ||
      /\boutreach\b/i.test(normalized) ||
      /\bgmail\b/i.test(normalized) ||
      emailMatches.length > 0);
  if (operationalEmailRequest) {
    const recipients = emailMatches.length > 0 ? emailMatches : ["recipient@example.com"];
    return {
      intent: "integration_request",
      summary: "Email integration request identified.",
      action: "send_email",
      requiresApproval: true,
      emailTo: recipients,
      emailSubject: "Request for quote",
      emailBody:
        "Hello, we are requesting a quote for our project. Please share pricing and availability.",
      taskTitle: `Send outreach email to ${recipients.length} contact(s)`
    };
  }

  if (/(create project|new project|setup project)/i.test(normalized)) {
    return {
      intent: "project_request",
      summary: "Project creation request identified.",
      action: "create_project",
      projectName: normalized.replace(/.*project\s*/i, "").trim() || "New Project"
    };
  }

  if (/(create task|add task|new task|todo)/i.test(normalized)) {
    return {
      intent: "task_request",
      summary: "Task request identified.",
      action: "create_task",
      requiresApproval: /\bapprove\b/i.test(normalized),
      taskTitle: normalized.replace(/.*task\s*/i, "").trim() || "New Task"
    };
  }

  if (/(save note|take note|new note)/i.test(normalized)) {
    return {
      intent: "note_request",
      summary: "Note request identified.",
      action: "create_note",
      noteTitle: "President Note",
      noteContent: normalized
    };
  }

  if (/(add contact|new contact|save contact)/i.test(normalized)) {
    return {
      intent: /\b(subcontractor|approve)\b/i.test(normalized)
        ? "approval_request"
        : "contact_request",
      summary: "Contact request identified.",
      action: "create_contact",
      requiresApproval: /\b(subcontractor|approve)\b/i.test(normalized),
      contactName: "New Contact",
      contactEmail: emailMatches[0] ?? "contact@example.com"
    };
  }

  if (/(openclaw|external agent)/i.test(normalized)) {
    return {
      intent: "external_action_request",
      summary: "External action request identified.",
      action: "openclaw",
      requiresApproval: true
    };
  }

  return {
    intent: "conversational",
    summary: "Conversational request routed to LLM."
  };
};

export const decideToolNeed = (prompt: string) => {
  const decision = routeIntent(normalizePromptForReasoning(prompt));
  return {
    useTool: decision.intent !== "conversational",
    intent: decision.intent
  };
};

const toPhiResponse = (prompt: string, decision: IntentDecision, response: string): PhiResponse => {
  const normalized = normalizePromptForReasoning(prompt);
  const needsSearch = decision.intent === "conversational" && shouldUseWebSearch(normalized);
  return phiResponseSchema.parse({
    intent: decision.intent,
    summary: decision.summary,
    response,
    requires_approval: Boolean(decision.requiresApproval),
    action: decision.action,
    project_name: decision.projectName,
    task_title: decision.taskTitle,
    note_title: decision.noteTitle,
    note_content: decision.noteContent,
    contact_name: decision.contactName,
    contact_email: decision.contactEmail,
    email_to: decision.emailTo,
    email_subject: decision.emailSubject,
    email_body: decision.emailBody,
    memory_query: decision.memoryQuery,
    memory_key: decision.memoryKey,
    memory_value: decision.memoryValue,
    translation_target_language: decision.translationTargetLanguage,
    translation_phrases: decision.translationPhrases,
    needs_web_search: needsSearch,
    web_search_query: needsSearch ? normalized : undefined
  });
};

const qualityFailed = (prompt: string, response: string) => {
  return (
    !response.trim() ||
    isTemplateLikeReply(response) ||
    looksLikePromptEcho(prompt, response) ||
    (isRecipePrompt(prompt) && !isRecipeQualityResponse(response))
  );
};

export const getPhiRuntimeState = () => runtimeState;
export const getLastPhiDebugMeta = () => lastPhiDebugMeta;

export const phiDirectAnswer = async (
  prompt: string,
  options: DirectAnswerOptions = {}
): Promise<string> => {
  const normalizedPrompt = normalizePromptForReasoning(prompt);
  const responseMode = options.responseMode ?? chooseResponseMode(normalizedPrompt);
  const tokenBudget = getTokenBudget(responseMode, normalizedPrompt);
  const llmPrompt = buildLLMPrompt(normalizedPrompt, {
    history: options.history ?? [],
    memoryGuidance: options.memoryGuidance ?? "",
    toolResultContext: options.toolResultContext,
    responseMode
  });

  let firstPass = "";
  try {
    firstPass =
      (await runModel(llmPrompt, {
        maxNewTokens: tokenBudget,
        temperature: 0.35
      })) ?? "";
  } catch {
    firstPass = "";
  }

  if (!firstPass) {
    markPhiDebug({
      mode: "system_fallback",
      usedWeakRepair: false,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: false,
      responseMode,
      outputTruncated: false,
      normalizedPrompt
    });
    return buildSystemFailureMessage();
  }

  let finalAnswer = firstPass;
  let usedRepair = false;
  if (qualityFailed(normalizedPrompt, firstPass)) {
    usedRepair = true;
    const repairPrompt = `${llmPrompt}\n\nRegenerate with stricter rules: answer directly, no filler intro, no prompt restatement, no placeholder content.`;
    try {
      const repaired =
        (await runModel(repairPrompt, {
          maxNewTokens: tokenBudget,
          temperature: 0.25
        })) ?? "";
      if (repaired && !qualityFailed(normalizedPrompt, repaired)) {
        finalAnswer = repaired;
      }
    } catch {
      // keep first pass
    }
  }

  const truncated = isLikelyTruncated(finalAnswer, tokenBudget);
  markPhiDebug({
    mode: "model",
    usedWeakRepair: usedRepair,
    usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
    llmCalled: true,
    responseMode,
    outputTruncated: truncated,
    normalizedPrompt
  });

  if (qualityFailed(normalizedPrompt, finalAnswer)) {
    markPhiDebug({
      mode: "system_fallback",
      usedWeakRepair: true,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: true,
      responseMode,
      outputTruncated: truncated,
      normalizedPrompt
    });
    return "I hit an output quality issue while generating that answer. Please retry once and I’ll regenerate it cleanly.";
  }

  return finalAnswer;
};

const deterministicSearchSynthesis = (input: SearchSynthesisInput) => {
  const answer = input.answerHint || input.keyFacts[0] || "I could not verify a reliable answer yet.";
  const facts = input.keyFacts.slice(0, 4);
  const sources = input.sources.slice(0, 4);
  return [
    answer,
    facts.length ? `\nKey facts:\n${facts.map((fact) => `- ${fact}`).join("\n")}` : "",
    sources.length
      ? `\nSources:\n${sources.map((source) => `- ${source.title} (${source.source})`).join("\n")}`
      : ""
  ]
    .join("\n")
    .trim();
};

export const phiSynthesizeSearchAnswer = async (input: SearchSynthesisInput): Promise<string> => {
  const synthesisPrompt = [
    `Question: ${input.question}`,
    `Answer hint: ${input.answerHint || "N/A"}`,
    `Key facts:\n${input.keyFacts.map((fact) => `- ${fact}`).join("\n") || "- none"}`,
    `Top sources:\n${
      input.sources
        .slice(0, 4)
        .map((source) => `- ${source.title} (${source.source}): ${source.snippet}`)
        .join("\n") || "- none"
    }`,
    `Warnings: ${input.warnings.join(" | ") || "none"}`
  ].join("\n\n");

  const synthesized = await phiDirectAnswer(input.question, {
    responseMode: "comprehensive",
    toolResultContext: synthesisPrompt
  });
  if (
    !synthesized ||
    synthesized === buildSystemFailureMessage() ||
    /^i hit an output quality issue/i.test(synthesized)
  ) {
    return deterministicSearchSynthesis(input);
  }
  return synthesized;
};

const ensureQuestionPunctuation = (phrase: string) => {
  const trimmed = phrase.trim();
  if (/[?.!]$/.test(trimmed)) {
    return trimmed;
  }
  return /^(how|what|where|when|why|who)\b/i.test(trimmed) ? `${trimmed}?` : trimmed;
};

const cleanTranslatedText = (value: string) => {
  return value
    .replace(/^translation\s*[:\-]\s*/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const extractTranslationRows = (output: string) => {
  const rows = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") || line.includes("->") || line.includes("→"))
    .map((line) => line.replace(/^-+\s*/, ""));
  return rows
    .map((row) => {
      const split = row.includes("->") ? row.split("->") : row.split("→");
      if (split.length < 2) {
        return null;
      }
      return {
        source: cleanTranslatedText(split[0] ?? ""),
        translated: cleanTranslatedText(split.slice(1).join("->"))
      };
    })
    .filter((row): row is { source: string; translated: string } => Boolean(row?.source && row?.translated));
};

export const phiTranslateRequest = async (
  prompt: string,
  targetLanguageInput?: string,
  phrasesInput?: string[]
): Promise<string> => {
  const parsedFromPrompt = parseTranslationIntent(prompt);
  const parsed =
    targetLanguageInput && phrasesInput && phrasesInput.length > 0
      ? {
          targetLanguage: targetLanguageInput as SupportedTranslationLanguage,
          phrases: phrasesInput
        }
      : parsedFromPrompt;

  if (!parsed || parsed.phrases.length === 0) {
    return "Please provide phrase(s) and a target language, for example: Translate 'how are you' into Spanish.";
  }

  const translationPrompt = [
    "You are a translation assistant.",
    `Translate each source phrase into ${languageLabel(parsed.targetLanguage)}.`,
    "Return only bullet lines in this exact format:",
    "- <source phrase> -> <translated phrase>",
    "No explanation text before or after the bullet list.",
    `Phrases:\n${parsed.phrases.slice(0, 8).map((phrase) => `- ${phrase}`).join("\n")}`
  ].join("\n");

  let output = "";
  try {
    output =
      (await runModel(translationPrompt, {
        maxNewTokens: 260,
        temperature: 0.15
      })) ?? "";
  } catch {
    output = "";
  }

  const rows = extractTranslationRows(output);
  if (!rows.length) {
    return "I couldn’t complete translation because the local model is unavailable right now. Please retry.";
  }

  return [
    `Here are the translations in ${languageLabel(parsed.targetLanguage)}:`,
    ...rows.map((row) => `- ${ensureQuestionPunctuation(row.source)} -> ${row.translated}`)
  ].join("\n");
};

export const phiLLM = async (
  prompt: string,
  history: ConversationTurn[] = []
): Promise<PhiResponse> => {
  const normalizedPrompt = normalizePromptForReasoning(prompt);
  const decision = routeIntent(normalizedPrompt);

  if (decision.intent !== "conversational") {
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: false,
      usedSearchHeuristic: false,
      llmCalled: false,
      responseMode: chooseResponseMode(normalizedPrompt),
      outputTruncated: false,
      normalizedPrompt
    });
    return toPhiResponse(normalizedPrompt, decision, decision.summary);
  }

  const responseMode = chooseResponseMode(normalizedPrompt);
  const directResponse = await phiDirectAnswer(normalizedPrompt, {
    history,
    responseMode
  });

  return toPhiResponse(
    normalizedPrompt,
    {
      ...decision,
      summary: "Conversational request handled through LLM-first reasoning."
    },
    directResponse
  );
};

export const phiSystemStatus = () => {
  return {
    name: SECRETARY_NAME,
    runtime: runtimeState,
    model: LOCAL_PHI_MODEL,
    model_ready: runtimeState === "ready",
    model_load_error: lastModelError,
    llm_called: lastPhiDebugMeta.llmCalled,
    llm_mode: lastPhiDebugMeta.mode,
    response_mode: lastPhiDebugMeta.responseMode,
    output_truncated: lastPhiDebugMeta.outputTruncated,
    normalized_prompt: lastPhiDebugMeta.normalizedPrompt,
    checked_at: now()
  };
};
