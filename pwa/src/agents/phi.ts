import { phiResponseSchema, type PhiResponse } from "@ajawai/shared";
import { LOCAL_PHI_MODEL, SECRETARY_NAME } from "../constants/module3";

type RuntimeState = "initializing" | "ready" | "fallback";

type GeneratorOutput = Array<{ generated_text?: string }>;
type GeneratorFn = (
  prompt: string,
  options?: Record<string, unknown>
) => Promise<GeneratorOutput>;

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
  mode: "heuristic" | "model" | "model_with_fallback";
  usedWeakRepair: boolean;
  usedSearchHeuristic: boolean;
  llmCalled: boolean;
  normalizedPrompt: string;
  checkedAt: string;
}

export interface DirectAnswerOptions {
  history?: ConversationTurn[];
  memoryGuidance?: string;
}

const now = () => new Date().toISOString();

let generatorPromise: Promise<GeneratorFn | null> | null = null;
let runtimeState: RuntimeState = "initializing";
let lastPhiDebugMeta: PhiDebugMeta = {
  mode: "heuristic",
  usedWeakRepair: false,
  usedSearchHeuristic: false,
  llmCalled: false,
  normalizedPrompt: "",
  checkedAt: now()
};

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
  const preferMatch = statement.match(/i\s+prefer\s+(.+)$/i);
  if (preferMatch?.[1]) {
    const preference = preferMatch[1].trim().replace(/\.$/, "");
    const key = /proposal|writing|tone|style/i.test(preference)
      ? "proposal_style"
      : "user_preference";
    return {
      key,
      value: preference
    };
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
  if (trimmed.toLowerCase().includes("memory")) {
    return normalizeMemoryKey(trimmed);
  }
  return null;
};

const looksLikeWeakReply = (reply: string) => {
  const lower = reply.toLowerCase();
  return (
    lower.includes("tell me any constraints") ||
    lower.includes("preferred style") ||
    lower.includes("share constraints") ||
    lower.includes("can you provide more details") ||
    lower.includes("i need more information to proceed") ||
    lower.includes("start by defining the exact outcome")
  );
};

const looksLikeWeakSynthesis = (reply: string) => {
  const lower = reply.toLowerCase();
  return (
    looksLikeWeakReply(reply) ||
    lower.includes("based on the provided sources") ||
    lower.includes("according to the snippets") ||
    lower.includes("the sources indicate") ||
    reply.trim().length < 40
  );
};

const markPhiDebug = (next: Partial<PhiDebugMeta>) => {
  lastPhiDebugMeta = {
    ...lastPhiDebugMeta,
    ...next,
    checkedAt: now()
  };
};

const normalizePromptForReasoning = (input: string) => {
  const normalized = input
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bwhat did you to do\b/gi, "what did you do")
    .replace(/\bhow do i self improve inspire me\b/gi, "how can I improve myself and stay inspired")
    .replace(/\bself improve\b/gi, "self-improve")
    .replace(/\bimprove me\b/gi, "help me improve")
    .replace(/\bi wanna\b/gi, "I want to")
    .replace(/\bgonna\b/gi, "going to")
    .replace(/\bpls\b/gi, "please")
    .replace(/\bthx\b/gi, "thanks");
  return normalized;
};

const sanitizeModelAnswer = (text: string) => {
  return text
    .replace(/^assistant:\s*/i, "")
    .replace(/^secretary phi:\s*/i, "")
    .trim();
};

const extractIntentText = (prompt: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/\.$/, "");
    }
  }
  return "";
};

const formatConversationContext = (history: ConversationTurn[]) => {
  if (!history.length) {
    return "No prior conversation context.";
  }
  return history
    .slice(-8)
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

const extractTopicFromQuestion = (prompt: string) => {
  const cleaned = prompt.trim().replace(/\?+$/, "");
  const match =
    cleaned.match(/^(?:what is|what's|who is|who's|explain|define)\s+(.+)$/i) ??
    cleaned.match(/^(?:tell me about)\s+(.+)$/i);
  return match?.[1]?.trim() ?? cleaned;
};

type SupportedTranslationLanguage = "spanish" | "french" | "english";

interface TranslationIntent {
  targetLanguage: SupportedTranslationLanguage;
  phrases: string[];
}

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

const normalizeTranslationPhrase = (value: string) => {
  return value
    .toLowerCase()
    .replace(/\bwhat did you to do\b/g, "what did you do")
    .replace(/\bhow say\b/g, "how do you say")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

const splitTranslationPhrases = (input: string): string[] => {
  const normalized = input
    .replace(/\bwhat did you to do\b/gi, "what did you do")
    .replace(/\b(how are you)\s+(what|where|when|why|how)\b/gi, "$1 ? $2")
    .replace(/\b(where are you from)\s+(what|where|when|why|how)\b/gi, "$1 ? $2")
    .replace(/\b(what are you doing)\s+(what|where|when|why|how)\b/gi, "$1 ? $2")
    .replace(/\bin\?\s*/gi, "? ")
    .replace(/\s+/g, " ")
    .trim();
  const chunks = normalized
    .split(/\?|\.|;|,(?!\d)|\band\b|\&|\n/gi)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .map((chunk) =>
      chunk
        .replace(/^(translate|say|how do you say|how say)\s+/i, "")
        .replace(/\s+(in|into|to)\s+(spanish|espanol|español|french|francais|français|english|ingles|inglés)\s*$/i, "")
        .trim()
    )
    .filter((chunk) => chunk.length > 0);

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
    /\b(say)\b/.test(lower) ||
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
  const explicitForMatch = prompt.match(languageForPattern);
  const howDoYouSayPattern = new RegExp(
    `how\\s*(?:do\\s*you\\s*)?say\\s+(.+?)\\s+(?:in|into|to)\\s+(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)`,
    "i"
  );
  const howDoYouSayMatch = prompt.match(howDoYouSayPattern);
  const translatePattern = new RegExp(
    `translate\\s+(.+?)\\s+(?:in|into|to)\\s+(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)`,
    "i"
  );
  const translateMatch = prompt.match(translatePattern);
  const sayPattern = new RegExp(
    `say\\s+(.+?)\\s+(?:in|into|to)\\s+(?:spanish|espanol|español|french|francais|français|english|ingles|inglés)`,
    "i"
  );
  const sayMatch = prompt.match(sayPattern);

  const sourceText =
    explicitForMatch?.[1] ??
    howDoYouSayMatch?.[1] ??
    translateMatch?.[1] ??
    sayMatch?.[1] ??
    prompt;

  const phrases = splitTranslationPhrases(sourceText);
  if (phrases.length === 0) {
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

const currentInfoPatterns = [
  /\bnet worth\b/i,
  /\bbillionaire\b/i,
  /\btoday\b/i,
  /\bcurrent\b/i,
  /\blatest\b/i,
  /\bnews\b/i,
  /\bnow\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  /\bthis year\b/i,
  /\brichest\b/i,
  /\branking\b/i,
  /\btop \d+\b/i,
  /\bstock\b/i,
  /\bprice\b/i,
  /\bmarket cap\b/i,
  /\bweather\b/i,
  /\blive\b/i
];

export const shouldUseWebSearch = (prompt: string) => {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();
  if (lower.length < 3) {
    return false;
  }
  if (parseTranslationIntent(normalized)) {
    return false;
  }
  if (lower.includes("remember that") || lower.includes("store memory")) {
    return false;
  }
  if (lower.includes("recipe")) {
    return false;
  }
  if (lower.includes("send email") || lower.includes("create task") || lower.includes("create project")) {
    return false;
  }
  if (currentInfoPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  return false;
};

const buildPestoRecipeReply = () => {
  return [
    "Absolutely — here is a comprehensive basil pesto recipe:",
    "",
    "Ingredients (about 1 to 1.25 cups):",
    "- 2 cups fresh basil leaves (packed, stems removed)",
    "- 1/2 cup extra-virgin olive oil (plus extra as needed)",
    "- 1/3 cup pine nuts (or walnuts for a budget swap)",
    "- 2 to 3 garlic cloves",
    "- 1/2 cup finely grated Parmigiano-Reggiano",
    "- 1/4 cup finely grated Pecorino Romano (optional but great)",
    "- 1/2 tsp kosher salt, plus more to taste",
    "- 1 to 2 tsp lemon juice (optional, brightens flavor)",
    "",
    "Step-by-step:",
    "1) Toast nuts: dry-toast pine nuts 2 to 3 minutes on medium-low until lightly golden; cool.",
    "2) Blend base: add basil, cooled nuts, garlic, and salt to a food processor; pulse until chopped.",
    "3) Emulsify: with motor running, slowly drizzle in olive oil until creamy.",
    "4) Finish: pulse in cheeses and lemon juice just until combined.",
    "5) Adjust: add a splash of oil if too thick; taste and adjust salt/lemon.",
    "",
    "How to use:",
    "- Pasta: thin pesto with 2 to 4 tbsp hot pasta water before tossing.",
    "- Sandwiches/wraps: spread directly.",
    "- Proteins/veg: spoon over chicken, fish, roasted potatoes, or grilled vegetables.",
    "",
    "Storage tips:",
    "- Fridge: 4 to 5 days in an airtight jar with a thin olive-oil layer on top.",
    "- Freezer: portion into ice cube trays, freeze, then transfer to a sealed bag for up to 3 months.",
    "",
    "Variations:",
    "- Dairy-free: skip cheese, add 2 to 3 tbsp nutritional yeast.",
    "- Nut-free: use toasted sunflower seeds or pepitas.",
    "- Restaurant-style silkiness: blend a little longer and finish with extra olive oil before serving."
  ].join("\n");
};

const buildChickenSoupReply = () => {
  return [
    "Great choice — here is a complete chicken soup recipe (serves 4 to 6):",
    "",
    "Ingredients:",
    "- 1 tbsp olive oil",
    "- 1 medium onion, diced",
    "- 2 carrots, sliced",
    "- 2 celery stalks, sliced",
    "- 3 garlic cloves, minced",
    "- 8 cups chicken broth",
    "- 2 cups cooked shredded chicken",
    "- 1 tsp dried thyme",
    "- 1 bay leaf",
    "- Salt and black pepper to taste",
    "- 1 cup egg noodles or cooked rice (optional)",
    "- 1 tbsp lemon juice + chopped parsley (finish)",
    "",
    "Instructions:",
    "1) Saute onion, carrot, and celery in olive oil for 6 to 8 minutes.",
    "2) Add garlic for 30 seconds, then stir in broth, thyme, and bay leaf.",
    "3) Simmer 15 minutes, add chicken, then simmer 10 more minutes.",
    "4) Add noodles (or rice) and cook until tender.",
    "5) Remove bay leaf, season with salt/pepper, finish with lemon and parsley.",
    "",
    "Quick upgrades:",
    "- Add ginger for extra warmth.",
    "- Add spinach in the last 2 minutes.",
    "- For meal prep, store noodles separately so they stay firm."
  ].join("\n");
};

const buildChocolateCakeReply = () => {
  return [
    "Absolutely — here is a rich, reliable chocolate cake recipe (2 x 8-inch layers):",
    "",
    "Ingredients:",
    "- 2 cups (250g) all-purpose flour",
    "- 2 cups (400g) granulated sugar",
    "- 3/4 cup (75g) unsweetened cocoa powder",
    "- 2 tsp baking powder",
    "- 1 1/2 tsp baking soda",
    "- 1 tsp fine salt",
    "- 2 eggs",
    "- 1 cup (240ml) milk",
    "- 1/2 cup (120ml) neutral oil",
    "- 2 tsp vanilla extract",
    "- 1 cup (240ml) hot coffee or hot water",
    "",
    "Steps:",
    "1) Heat oven to 350°F / 175°C. Grease and line two 8-inch pans.",
    "2) Whisk flour, sugar, cocoa, baking powder, baking soda, and salt.",
    "3) Add eggs, milk, oil, and vanilla. Mix until smooth.",
    "4) Stir in hot coffee/water (batter will be thin).",
    "5) Divide into pans and bake 30–35 minutes until a toothpick comes out clean.",
    "6) Cool 10 minutes in pans, then fully cool on a rack before frosting.",
    "",
    "Quick chocolate frosting:",
    "- Beat 1 cup (226g) butter, 3 1/2 cups powdered sugar, 1/2 cup cocoa, pinch salt, 2 tsp vanilla, and 3–5 tbsp milk.",
    "",
    "Tips:",
    "- Use coffee for deeper chocolate flavor (it won’t taste like coffee).",
    "- Chill layers 20 minutes before frosting for cleaner assembly.",
    "- Store covered at room temp 1 day or refrigerated up to 4 days."
  ].join("\n");
};

const buildBananaBreadReply = () => {
  return [
    "Great pick — here is a moist banana bread recipe (1 loaf):",
    "",
    "Ingredients:",
    "- 3 very ripe bananas, mashed",
    "- 1/2 cup (113g) melted butter",
    "- 3/4 cup (150g) brown sugar",
    "- 2 eggs",
    "- 1 tsp vanilla",
    "- 1 1/2 cups (190g) all-purpose flour",
    "- 1 tsp baking soda",
    "- 1/2 tsp salt",
    "- 1 tsp cinnamon (optional)",
    "- 1/2 cup chopped walnuts or chocolate chips (optional)",
    "",
    "Steps:",
    "1) Heat oven to 350°F / 175°C. Grease a 9x5 loaf pan.",
    "2) Mix bananas, butter, sugar, eggs, and vanilla.",
    "3) Add flour, baking soda, salt, and cinnamon; stir just until combined.",
    "4) Fold in nuts/chips if using.",
    "5) Bake 50–60 minutes until center is set and a tester comes out mostly clean.",
    "6) Cool 15 minutes in pan, then transfer to rack.",
    "",
    "Tips:",
    "- Use heavily speckled bananas for best flavor.",
    "- Do not overmix once flour is added.",
    "- Wrap and rest overnight for even better texture."
  ].join("\n");
};

const buildGenericRecipeReply = (dish: string) => {
  const title = dish.replace(/\?+$/, "").trim();
  return [
    `Absolutely — here is a practical ${title} recipe template you can cook right away:`,
    "",
    "Ingredients:",
    "- main ingredient(s)",
    "- aromatics (onion/garlic or equivalent)",
    "- fat (oil/butter)",
    "- seasoning (salt/pepper/herbs/spices)",
    "- optional texture/flavor add-ons",
    "",
    "Steps:",
    "1) Prep all ingredients and preheat pan/oven.",
    "2) Build flavor with aromatics and seasoning first.",
    "3) Cook the main ingredient until properly done.",
    "4) Adjust texture/liquid and taste for salt/acid.",
    "5) Rest briefly, then serve.",
    "",
    "Tips:",
    "- Keep heat moderate to avoid overcooking.",
    "- Taste at least twice before serving.",
    "- Add acid (lemon/vinegar) at the end to brighten flavor.",
    "",
    "If you want, I can now give an exact ingredient-by-ingredient version with measurements for your preferred serving size."
  ].join("\n");
};

const buildContractExplainerReply = () => {
  return [
    "I can help explain it clearly. If you share the text, I can summarize it line by line.",
    "For now, here is a practical contract breakdown framework:",
    "",
    "1) Scope and deliverables:",
    "- Exactly what must be delivered, by whom, and by when.",
    "",
    "2) Payment terms:",
    "- Amount, payment schedule, due dates, late fees, and expense rules.",
    "",
    "3) Deadlines and milestones:",
    "- Key dates, dependencies, and what counts as acceptance/completion.",
    "",
    "4) Risk clauses:",
    "- Liability caps, indemnity, warranties, limitation of damages.",
    "",
    "5) Termination:",
    "- How either side can exit, notice periods, and post-termination obligations.",
    "",
    "6) IP and confidentiality:",
    "- Who owns work product, reuse rights, data handling, NDA obligations.",
    "",
    "7) Dispute resolution:",
    "- Governing law, venue, arbitration/mediation requirements.",
    "",
    "If you paste the contract (or key sections), I’ll convert this into a plain-English summary and flag risky clauses immediately."
  ].join("\n");
};

const buildDraftEmailReply = (prompt: string) => {
  const topic = extractIntentText(prompt, [
    /draft an email (?:about|for|to)\s+(.+)$/i,
    /write an email (?:about|for|to)\s+(.+)$/i,
    /compose an email (?:about|for|to)\s+(.+)$/i
  ]);
  const subject = topic ? `Subject: ${topic.slice(0, 80)}` : "Subject: Quick follow-up";
  return [
    "Absolutely — here is a polished draft you can use:",
    "",
    subject,
    "",
    "Hi [Name],",
    "",
    topic
      ? `I’m reaching out regarding ${topic}. I wanted to share a concise update and align on next steps.`
      : "I wanted to follow up and align on next steps.",
    "",
    "If helpful, I can provide additional context, timelines, and a short action plan.",
    "",
    "Would you be available for a quick reply by [date/time]?",
    "",
    "Best,",
    "[Your Name]"
  ].join("\n");
};

const buildInvoiceFactoringReply = () => {
  return [
    "Invoice factoring is a financing method where a business sells unpaid invoices to a factoring company at a discount to get cash immediately.",
    "",
    "How it works:",
    "1) You issue an invoice to a customer.",
    "2) A factoring company advances you most of the invoice value (often 70–90%).",
    "3) When the customer pays, the factor sends the remaining balance minus fees.",
    "",
    "Why companies use it:",
    "- Improves cash flow quickly.",
    "- Helps cover payroll, materials, and operations while waiting on payment terms.",
    "",
    "Main trade-offs:",
    "- More expensive than some traditional loans.",
    "- Your customer payments are usually handled through the factor.",
    "",
    "Two common types:",
    "- Recourse factoring: you may owe money back if the customer never pays.",
    "- Non-recourse factoring: factor takes more credit risk, usually at higher cost."
  ].join("\n");
};

const buildSelfImproveReply = () => {
  return [
    "You’re not behind — you’re building. The strongest self-improvement comes from small, consistent wins, not one big perfect day.",
    "",
    "Here’s a practical framework you can start today:",
    "1) Pick one identity goal: \"I’m becoming disciplined and reliable.\"",
    "2) Start tiny: 20 minutes daily on one high-impact habit.",
    "3) Protect your focus: one deep-work block before checking distractions.",
    "4) Train your body: sleep 7-8 hours, move daily, hydrate, and eat clean enough.",
    "5) Upgrade your mind: read 10 pages/day and journal one lesson nightly.",
    "6) Review weekly: what worked, what failed, what you’ll adjust next week.",
    "",
    "Mindset shift that helps:",
    "- Don’t ask \"Am I motivated?\" Ask \"What’s my next small action?\"",
    "- Confidence grows after action, not before it.",
    "",
    "Today’s action plan (simple):",
    "- Write 3 priorities for tomorrow.",
    "- Complete one 25-minute focused session on your top goal.",
    "- End the day with one sentence: \"Today I improved by ___\".",
    "",
    "You can absolutely do this. If you want, I can build a 7-day self-improvement plan tailored to your schedule."
  ].join("\n");
};

const buildFactualFallback = (prompt: string) => {
  const topic = extractTopicFromQuestion(prompt);
  return `I’m checking live sources for ${topic} and will provide a clear answer first, followed by concise supporting references.`;
};

const buildFriendlyConversationalReply = (prompt: string): string => {
  const normalized = normalizePromptForReasoning(prompt);
  const lower = normalized.toLowerCase();

  if (lower.includes("pesto recipe") || lower.includes("how to make pesto") || lower.includes("make pesto")) {
    return buildPestoRecipeReply();
  }

  if (lower.includes("chicken soup recipe") || lower === "chicken soup recipe") {
    return buildChickenSoupReply();
  }

  if (lower.includes("chocolate cake")) {
    return buildChocolateCakeReply();
  }

  if (lower.includes("banana bread")) {
    return buildBananaBreadReply();
  }

  if (
    lower.includes("draft an email") ||
    lower.includes("write an email") ||
    lower.includes("compose an email")
  ) {
    return buildDraftEmailReply(normalized);
  }

  if (lower.includes("explain this contract") || lower.includes("contract")) {
    return buildContractExplainerReply();
  }

  if (lower.includes("invoice factoring")) {
    return buildInvoiceFactoringReply();
  }

  if (
    lower.includes("self-improve") ||
    lower.includes("self improve") ||
    lower.includes("improve myself") ||
    (lower.includes("inspire me") && lower.includes("improve"))
  ) {
    return buildSelfImproveReply();
  }

  if (lower.includes("richest person in the world") || lower.includes("who's the richest")) {
    return [
      "The richest person is currently reported as Elon Musk in most recent billionaire rankings.",
      "This changes with market prices, so I will verify with live sources for the latest number."
    ].join(" ");
  }

  if (lower.includes("brainstorm")) {
    return "Great direction. Here are three strong options to start: (1) fastest path with minimal risk, (2) balanced path with moderate effort and higher upside, and (3) ambitious path with maximum upside. If you share your target outcome and timeline, I can turn one option into an action plan right now.";
  }

  if (lower.includes("help")) {
    return "Absolutely. Tell me the exact result you want, and I will give you a direct plan with steps, copy-ready text, or a draft you can use immediately.";
  }

  const makeMatch =
    normalized.match(/how do i make (.+)\??$/i) ??
    normalized.match(/how to make (.+)\??$/i) ??
    normalized.match(/(.+)\s+recipe$/i) ??
    normalized.match(/recipe for (.+)$/i);
  if (makeMatch?.[1]) {
    return buildGenericRecipeReply(makeMatch[1]);
  }

  if (shouldUseWebSearch(normalized)) {
    return buildFactualFallback(normalized);
  }

  const topic = extractTopicFromQuestion(normalized);
  return `I can help with ${topic}.`;
};

const heuristicPhi = (prompt: string): PhiResponse => {
  const normalized = normalizePromptForReasoning(prompt);
  const lower = normalized.toLowerCase();
  const emailMatches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];

  const memorySave = parseMemorySave(normalized);
  if (memorySave) {
    return phiResponseSchema.parse({
      intent: "memory_save",
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
      intent: "memory_recall",
      summary: "Memory recall intent identified.",
      response: `${SECRETARY_NAME} is checking memory for that.`,
      requires_approval: false,
      memory_query: memoryRecall
    });
  }

  const translationIntent = parseTranslationIntent(normalized);
  if (translationIntent) {
    return phiResponseSchema.parse({
      intent: "translation_request",
      summary: `Translation request identified (${languageLabel(translationIntent.targetLanguage)}).`,
      response: `I can translate that into ${languageLabel(translationIntent.targetLanguage)} right away.`,
      requires_approval: false,
      needs_web_search: false,
      translation_target_language: translationIntent.targetLanguage,
      translation_phrases: translationIntent.phrases
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

  const draftOnlyEmail =
    lower.includes("draft an email") ||
    lower.includes("write an email") ||
    lower.includes("compose an email");
  const operationalEmailRequest =
    !draftOnlyEmail &&
    (lower.includes("send email") ||
      lower.startsWith("email ") ||
      lower.includes("email 10") ||
      lower.includes("reach out") ||
      lower.includes("outreach") ||
      lower.includes("gmail") ||
      emailMatches.length > 0);

  if (operationalEmailRequest) {
    const recipients = emailMatches.length > 0 ? emailMatches : ["recipient@example.com"];
    const response = {
      intent: "integration_request",
      action: "send_email",
      summary: "Prepared email draft for Pico Claw integration flow.",
      response: `${SECRETARY_NAME} drafted the email and prepared the approval flow.`,
      requires_approval: true,
      email_to: recipients,
      email_subject: "Request for quote",
      email_body:
        "Hello, we are requesting a quote for our project. Please share pricing and availability.",
      task_title: `Send outreach email to ${recipients.length} contact(s)`
    };

    return phiResponseSchema.parse(response);
  }

  if (
    lower.includes("create project") ||
    lower.includes("new project") ||
    lower.includes("setup project")
  ) {
    const response = {
      intent: "project_request",
      action: "create_project",
      summary: "Project intent identified.",
      response: `${SECRETARY_NAME} can create this project for you.`,
      requires_approval: false,
      project_name: normalized.replace(/.*project\s*/i, "").trim() || "New Project"
    };
    return phiResponseSchema.parse(response);
  }

  if (
    lower.includes("create task") ||
    lower.includes("add task") ||
    lower.includes("new task") ||
    lower.includes("todo")
  ) {
    const needsApproval = lower.includes("approve");
    const response = {
      intent: "task_request",
      action: "create_task",
      summary: "Task intent identified.",
      response: `${SECRETARY_NAME} can set up this task.`,
      requires_approval: needsApproval,
      task_title: normalized.replace(/.*task\s*/i, "").trim() || "New Task"
    };
    return phiResponseSchema.parse(response);
  }

  if (lower.includes("save note") || lower.includes("take note") || lower.includes("new note")) {
    const response = {
      intent: "note_request",
      action: "create_note",
      summary: "Note capture intent identified.",
      response: `${SECRETARY_NAME} can save this as a note.`,
      requires_approval: false,
      note_title: "President Note",
      note_content: normalized
    };
    return phiResponseSchema.parse(response);
  }

  if (
    lower.includes("add contact") ||
    lower.includes("new contact") ||
    lower.includes("save contact")
  ) {
    const needsApproval = lower.includes("subcontractor") || lower.includes("approve");
    const response = {
      intent: needsApproval ? "approval_request" : "contact_request",
      action: "create_contact",
      summary: "Contact intent identified.",
      response: `${SECRETARY_NAME} prepared a new contact entry.`,
      requires_approval: needsApproval,
      contact_name: "New Contact",
      contact_email: emailMatches[0] ?? "contact@example.com"
    };
    return phiResponseSchema.parse(response);
  }

  if (lower.includes("openclaw") || lower.includes("external agent")) {
    return phiResponseSchema.parse({
      intent: "external_action_request",
      action: "openclaw",
      summary: "External action request identified.",
      response: `${SECRETARY_NAME} can route this to Pico Claw external operations.`,
      requires_approval: true
    });
  }

  return phiResponseSchema.parse({
    intent: "conversational",
    summary: "Conversational request handled by Secretary Phi.",
    response: buildFriendlyConversationalReply(normalized),
    needs_web_search: shouldUseWebSearch(normalized),
    web_search_query: shouldUseWebSearch(normalized) ? normalized : undefined,
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

const buildPrompt = (prompt: string, history: ConversationTurn[]) => {
  return [
    "You are Secretary Phi in AJAWAI.",
    "Return JSON only with keys:",
    "intent, summary, response, requires_approval, action, project_name, task_title, note_title, note_content, contact_name, contact_email, email_to, email_subject, email_body, needs_web_search, web_search_query, translation_target_language, translation_phrases, memory_query, memory_key, memory_value.",
    "Choose intent from conversational, translation_request, status_query, memory_save, memory_recall, task_request, project_request, note_request, contact_request, approval_request, integration_request, external_action_request, general.",
    "For normal questions, give a complete direct helpful response immediately in response.",
    "Do not ask for constraints unless absolutely required.",
    "Avoid filler language.",
    "If action sends email, set requires_approval true.",
    `Conversation context:\n${formatConversationContext(history)}`,
    `User request: ${prompt}`
  ].join("\n");
};

const buildDirectAnswerPrompt = (
  prompt: string,
  history: ConversationTurn[],
  memoryGuidance?: string
) => {
  return [
    "You are Secretary Phi in AJAWAI.",
    "Answer the user directly with a complete, useful response.",
    "Be friendly and natural.",
    "Do not ask follow-up questions unless absolutely necessary.",
    "Do not use filler text.",
    `Conversation context:\n${formatConversationContext(history)}`,
    memoryGuidance ? `User memory context:\n${memoryGuidance}` : "User memory context: none",
    `User request: ${prompt}`
  ].join("\n");
};

const buildSingleTranslationPrompt = (phrase: string, targetLanguage: SupportedTranslationLanguage) => {
  return [
    "You are a translation assistant.",
    `Translate the phrase into ${languageLabel(targetLanguage)}.`,
    "Return only the translated phrase. No explanation.",
    `Phrase: ${phrase}`
  ].join("\n");
};

const cleanTranslatedText = (value: string) => {
  return value
    .replace(/^translation\s*[:\-]\s*/i, "")
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
};

const ensureQuestionPunctuation = (phrase: string) => {
  const trimmed = phrase.trim();
  if (/[?.!]$/.test(trimmed)) {
    return trimmed;
  }
  return /^(how|what|where|when|why|who)\b/i.test(trimmed) ? `${trimmed}?` : trimmed;
};

const looksLikeTranslatedOutput = (value: string, targetLanguage: SupportedTranslationLanguage) => {
  if (!value || value.length < 2) {
    return false;
  }
  if (targetLanguage === "spanish") {
    return /[¿¡áéíóúñ]/i.test(value) || /\b(que|como|donde|hasta|buenos)\b/i.test(value);
  }
  if (targetLanguage === "french") {
    return /[àâçéèêëîïôûùüÿœ]/i.test(value) || /\b(bonjour|demain|où|comment)\b/i.test(value);
  }
  return true;
};

const translatePhraseWithModel = async (
  phrase: string,
  targetLanguage: SupportedTranslationLanguage
): Promise<string | null> => {
  const generator = await initializeLocalPhi();
  if (!generator) {
    return null;
  }
  try {
    const output = await generator(buildSingleTranslationPrompt(phrase, targetLanguage), {
      max_new_tokens: 80,
      temperature: 0.1,
      return_full_text: false
    });
    const translated = cleanTranslatedText(output[0]?.generated_text ?? "");
    if (!looksLikeTranslatedOutput(translated, targetLanguage)) {
      return null;
    }
    return translated;
  } catch {
    return null;
  }
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
    return "Please share the phrase(s) and target language, for example: Translate \"how are you\" into Spanish.";
  }

  const translatedRows: Array<{ source: string; translated: string }> = [];
  for (const phrase of parsed.phrases.slice(0, 8)) {
    const fromModel = await translatePhraseWithModel(phrase, parsed.targetLanguage);
    const backupFromLLM = fromModel
      ? null
      : await phiDirectAnswer(
          `Translate the following text into ${languageLabel(parsed.targetLanguage)}: ${phrase}`
        );
    const translatedCandidate = cleanTranslatedText(
      fromModel ?? backupFromLLM?.split("\n")[0] ?? ""
    );
    const translated = translatedCandidate
      ? translatedCandidate
      : "[Translation currently unavailable]";
    translatedRows.push({
      source: ensureQuestionPunctuation(phrase),
      translated
    });
  }

  return [
    `Here are the translations in ${languageLabel(parsed.targetLanguage)}:`,
    ...translatedRows.map((row) => `- ${row.source} -> ${row.translated}`)
  ].join("\n");
};

const buildSearchSynthesisPrompt = (input: SearchSynthesisInput) => {
  const compactSources = input.sources
    .slice(0, 4)
    .map((source, index) => {
      return `${index + 1}) ${source.title} [${source.source}]${source.score ? ` (score ${source.score})` : ""}: ${source.snippet}`;
    })
    .join("\n");
  const compactFacts = input.keyFacts
    .slice(0, 4)
    .map((fact, index) => `${index + 1}) ${fact}`)
    .join("\n");

  return [
    "You are Secretary Phi in AJAWAI.",
    "Write a polished answer for the user.",
    "Rules:",
    "- Start with a direct answer in 1-2 sentences.",
    "- Then give a short context paragraph.",
    "- Then include a brief 'Key facts:' bullet list when useful (max 4 bullets).",
    "- Do not mention snippets, sources processing, or internal pipeline.",
    "- Do not hedge excessively.",
    "- Keep it concise but useful.",
    `Question: ${input.question}`,
    `Answer hint: ${input.answerHint || "N/A"}`,
    `Cross-referenced key facts:\n${compactFacts || "N/A"}`,
    `Top sources:\n${compactSources || "N/A"}`,
    `Warnings: ${input.warnings.join(" | ") || "none"}`
  ].join("\n");
};

const buildConciseFallbackAnswer = (prompt: string) => {
  const normalized = prompt.trim();
  const lower = normalized.toLowerCase();
  if (lower.includes("pesto")) {
    return buildPestoRecipeReply();
  }
  if (lower.includes("chicken soup")) {
    return buildChickenSoupReply();
  }
  if (lower.includes("invoice factoring")) {
    return buildInvoiceFactoringReply();
  }
  if (lower.includes("self-improve") || lower.includes("inspire me")) {
    return buildSelfImproveReply();
  }
  return "I’m having trouble using the local reasoning model right now. Please retry your question in a moment.";
};

const looksLikePromptEcho = (prompt: string, response: string) => {
  const p = normalizePromptForReasoning(prompt).toLowerCase();
  const r = response.toLowerCase().trim();
  if (!r) {
    return true;
  }
  if (r.startsWith(`answer: ${p}`) || r.startsWith(p)) {
    return true;
  }
  return false;
};

const deterministicSearchSynthesis = (input: SearchSynthesisInput) => {
  const direct = input.answerHint || input.keyFacts[0] || input.sources[0]?.snippet || "I could not verify a reliable answer yet.";
  const contextLine = input.keyFacts[1] || input.sources[1]?.snippet || "";
  const keyFacts = input.keyFacts.length > 0 ? input.keyFacts.slice(0, 4) : input.sources.slice(0, 3).map((source) => source.snippet);

  const sections = [
    direct,
    contextLine ? `\n${contextLine}` : "",
    keyFacts.length > 0
      ? `\nKey facts:\n${keyFacts.map((fact) => `- ${fact}`).join("\n")}`
      : ""
  ].join("\n");

  return sanitizeModelAnswer(sections).trim();
};

export const getPhiRuntimeState = () => runtimeState;
export const getLastPhiDebugMeta = () => lastPhiDebugMeta;

export const phiDirectAnswer = async (
  prompt: string,
  options: DirectAnswerOptions = {}
): Promise<string> => {
  const normalizedPrompt = normalizePromptForReasoning(prompt);
  const history = options.history ?? [];
  const fallback = buildConciseFallbackAnswer(normalizedPrompt);
  const generator = await initializeLocalPhi();
  if (!generator) {
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: false,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: false,
      normalizedPrompt
    });
    return fallback;
  }

  try {
    const output = await generator(
      buildDirectAnswerPrompt(normalizedPrompt, history, options.memoryGuidance),
      {
        max_new_tokens: 420,
        temperature: 0.4,
        return_full_text: false
      }
    );
    const text = sanitizeModelAnswer(output[0]?.generated_text ?? "");
    if (!text || looksLikeWeakReply(text) || looksLikePromptEcho(normalizedPrompt, text)) {
      markPhiDebug({
        mode: "model_with_fallback",
        usedWeakRepair: true,
        usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
        llmCalled: true,
        normalizedPrompt
      });
      return fallback;
    }
    markPhiDebug({
      mode: "model",
      usedWeakRepair: false,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: true,
      normalizedPrompt
    });
    return text;
  } catch {
    markPhiDebug({
      mode: "model_with_fallback",
      usedWeakRepair: true,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: true,
      normalizedPrompt
    });
    return fallback;
  }
};

export const phiSynthesizeSearchAnswer = async (input: SearchSynthesisInput): Promise<string> => {
  const fallback = deterministicSearchSynthesis(input);
  const generator = await initializeLocalPhi();
  if (!generator) {
    return fallback;
  }

  try {
    const output = await generator(buildSearchSynthesisPrompt(input), {
      max_new_tokens: 420,
      temperature: 0.35,
      return_full_text: false
    });
    const text = sanitizeModelAnswer(output[0]?.generated_text ?? "");
    if (looksLikeWeakSynthesis(text)) {
      return fallback;
    }
    return text;
  } catch {
    return fallback;
  }
};

export const phiLLM = async (
  prompt: string,
  history: ConversationTurn[] = []
): Promise<PhiResponse> => {
  const normalizedPrompt = normalizePromptForReasoning(prompt);
  const deterministic = heuristicPhi(normalizedPrompt);
  if (deterministic.intent !== "conversational") {
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: false,
      usedSearchHeuristic: Boolean(deterministic.needs_web_search),
      llmCalled: false,
      normalizedPrompt
    });
    return deterministic;
  }

  const generator = await initializeLocalPhi();
  if (!generator) {
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: false,
      usedSearchHeuristic: Boolean(deterministic.needs_web_search),
      llmCalled: false,
      normalizedPrompt
    });
    return deterministic;
  }

  try {
    const generateDirectAnswer = async () => {
      const directOutput = await generator(buildDirectAnswerPrompt(normalizedPrompt, history), {
        max_new_tokens: 420,
        temperature: 0.45,
        return_full_text: false
      });
      return sanitizeModelAnswer(directOutput[0]?.generated_text ?? "");
    };

    const output = await generator(buildPrompt(normalizedPrompt, history), {
      max_new_tokens: 256,
      temperature: 0.2,
      return_full_text: false
    });

    const text = output[0]?.generated_text ?? "";
    const candidate = jsonFromText(text);
    const parsed = phiResponseSchema.safeParse(candidate);
    if (parsed.success) {
      const modelResult = parsed.data;
      if (modelResult.intent === "conversational" || modelResult.intent === "general") {
        let directResponse = sanitizeModelAnswer(modelResult.response);
        let usedWeakRepair = false;
        if (!directResponse || looksLikeWeakReply(directResponse)) {
          const generated = await generateDirectAnswer().catch(() => "");
          directResponse =
            generated && !looksLikeWeakReply(generated) ? generated : deterministic.response;
          usedWeakRepair = true;
        }
        markPhiDebug({
          mode: usedWeakRepair ? "model_with_fallback" : "model",
          usedWeakRepair,
          usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
          llmCalled: true,
          normalizedPrompt
        });
        return phiResponseSchema.parse({
          ...modelResult,
          intent: "conversational",
          summary: "Conversational request handled directly by Secretary Phi.",
          response: directResponse,
          needs_web_search: shouldUseWebSearch(normalizedPrompt),
          web_search_query: shouldUseWebSearch(normalizedPrompt) ? normalizedPrompt : undefined,
          requires_approval: false
        });
      }
      markPhiDebug({
        mode: "model",
        usedWeakRepair: false,
        usedSearchHeuristic: Boolean(modelResult.needs_web_search),
        llmCalled: true,
        normalizedPrompt
      });
      return modelResult;
    }
    const generated = await generateDirectAnswer().catch(() => "");
    if (generated && !looksLikeWeakReply(generated)) {
      markPhiDebug({
        mode: "model_with_fallback",
        usedWeakRepair: true,
        usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
        llmCalled: true,
        normalizedPrompt
      });
      return phiResponseSchema.parse({
        ...deterministic,
        intent: "conversational",
        summary: "Conversational request handled directly by Secretary Phi.",
        response: generated,
        needs_web_search: shouldUseWebSearch(normalizedPrompt),
        web_search_query: shouldUseWebSearch(normalizedPrompt) ? normalizedPrompt : undefined,
        requires_approval: false
      });
    }
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: true,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: true,
      normalizedPrompt
    });
    return deterministic;
  } catch {
    runtimeState = "fallback";
    markPhiDebug({
      mode: "heuristic",
      usedWeakRepair: true,
      usedSearchHeuristic: shouldUseWebSearch(normalizedPrompt),
      llmCalled: true,
      normalizedPrompt
    });
    return deterministic;
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
