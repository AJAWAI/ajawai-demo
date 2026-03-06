export interface PublicWebSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at?: string;
  score?: number;
}

export interface PublicWebSearchImage {
  title: string;
  image_url: string;
  source_url: string;
}

export interface PublicWebSearchResult {
  ok: boolean;
  query: string;
  answer_hint: string;
  sources: PublicWebSearchSource[];
  images: PublicWebSearchImage[];
  key_facts: string[];
  warnings: string[];
  fetched_at: string;
}

const SEARCH_TIMEOUT_MS = 9_000;

type DuckDuckGoTopic = {
  Text?: string;
  FirstURL?: string;
  Topics?: DuckDuckGoTopic[];
};

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoTopic[];
};

const nowIso = () => new Date().toISOString();

const decodeHtmlEntities = (value: string) => {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_full, code) => {
      const num = Number(code);
      if (!Number.isFinite(num)) {
        return "";
      }
      return String.fromCharCode(num);
    });
};

const stripMarkupNoise = (value: string) => {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[0-9]+\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E]+/g, " ")
    .trim();
};

const cleanText = (value: string, maxLength = 240) => {
  const normalized = stripMarkupNoise(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const tokenize = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
};

const overlapScore = (a: string[], b: string[]) => {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const setB = new Set(b);
  let matches = 0;
  for (const token of a) {
    if (setB.has(token)) {
      matches += 1;
    }
  }
  return matches;
};

const getDomain = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const sourceDomainBoost = (domain: string) => {
  if (!domain) {
    return 0;
  }
  if (domain.endsWith(".wikipedia.org")) {
    return 16;
  }
  if (domain.includes("reuters.com")) {
    return 14;
  }
  if (domain.includes("bloomberg.com")) {
    return 14;
  }
  if (domain.includes("forbes.com")) {
    return 12;
  }
  if (domain.includes("wsj.com") || domain.includes("ft.com")) {
    return 12;
  }
  if (domain.includes(".gov")) {
    return 12;
  }
  if (domain.includes(".edu")) {
    return 10;
  }
  return 5;
};

const isLowValueSnippet = (snippet: string) => {
  const lower = snippet.toLowerCase();
  return (
    snippet.length < 40 ||
    lower.includes("may refer to") ||
    lower.includes("disambiguation") ||
    lower.includes("click here") ||
    lower.includes("cookie") ||
    lower.includes("subscribe")
  );
};

const isLikelyImageRelevant = (query: string) => {
  const q = query.toLowerCase();
  return (
    q.includes("who is") ||
    q.includes("richest") ||
    q.includes("company") ||
    q.includes("person") ||
    q.includes("city") ||
    q.includes("country") ||
    q.includes("what does") ||
    q.includes("what is")
  );
};

const withTimeout = async (url: string) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
};

const collectDuckTopics = (topics: DuckDuckGoTopic[] = []): PublicWebSearchSource[] => {
  const rows: PublicWebSearchSource[] = [];
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      const title = cleanText(topic.Text.split(" - ")[0] ?? topic.Text, 90);
      rows.push({
        title,
        url: topic.FirstURL,
        snippet: cleanText(topic.Text, 220),
        source: "DuckDuckGo"
      });
    }
    if (topic.Topics?.length) {
      rows.push(...collectDuckTopics(topic.Topics));
    }
  }
  return rows;
};

const searchDuckDuckGo = async (query: string) => {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    "&format=json&no_html=1&skip_disambig=1";
  const response = await withTimeout(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo failed (${response.status})`);
  }
  const payload = (await response.json()) as DuckDuckGoResponse;
  const sources: PublicWebSearchSource[] = [];
  const answerHint = cleanText(payload.AbstractText ?? "", 420);
  if (payload.AbstractURL && payload.AbstractText) {
    sources.push({
      title: cleanText(payload.Heading ?? query, 90),
      url: payload.AbstractURL,
      snippet: cleanText(payload.AbstractText, 220),
      source: "DuckDuckGo"
    });
  }
  sources.push(...collectDuckTopics(payload.RelatedTopics ?? []));
  return {
    answerHint,
    sources
  };
};

const searchWikipedia = async (query: string): Promise<PublicWebSearchSource[]> => {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&list=search" +
    `&srsearch=${encodeURIComponent(query)}` +
    "&srlimit=6&utf8=1&format=json&origin=*";
  const response = await withTimeout(url);
  if (!response.ok) {
    throw new Error(`Wikipedia failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    query?: {
      search?: Array<{
        title?: string;
        snippet?: string;
      }>;
    };
  };
  const rows = payload.query?.search ?? [];
  return rows.map((row) => {
    const title = cleanText(row.title ?? query, 90);
    return {
      title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent((row.title ?? "").replace(/\s+/g, "_"))}`,
      snippet: cleanText((row.snippet ?? "").replace(/<[^>]+>/g, ""), 220),
      source: "Wikipedia"
    };
  });
};

const searchWikipediaImages = async (query: string): Promise<PublicWebSearchImage[]> => {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}` +
    "&gsrlimit=6&prop=pageimages|info&inprop=url&pithumbsize=640&format=json&origin=*";
  const response = await withTimeout(url);
  if (!response.ok) {
    throw new Error(`Image lookup failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          fullurl?: string;
          thumbnail?: {
            source?: string;
          };
        }
      >;
    };
  };
  const pages = Object.values(payload.query?.pages ?? {});
  return pages
    .filter((page) => page.fullurl && page.thumbnail?.source)
    .slice(0, 4)
    .map((page) => ({
      title: cleanText(page.title ?? "Image", 90),
      image_url: page.thumbnail?.source ?? "",
      source_url: page.fullurl ?? ""
    }));
};

const dedupeSources = (rows: PublicWebSearchSource[]) => {
  const seen = new Set<string>();
  const seenTitleDomain = new Set<string>();
  const deduped: PublicWebSearchSource[] = [];
  for (const row of rows) {
    if (!row.url || seen.has(row.url)) {
      continue;
    }
    const titleDomain = `${cleanText(row.title, 80).toLowerCase()}::${getDomain(row.url)}`;
    if (seenTitleDomain.has(titleDomain)) {
      continue;
    }
    seen.add(row.url);
    seenTitleDomain.add(titleDomain);
    deduped.push(row);
  }
  return deduped;
};

const rankSources = (query: string, rows: PublicWebSearchSource[]) => {
  const queryTokens = tokenize(query);
  const scored = rows
    .map((row) => {
      const cleanTitle = cleanText(row.title, 110);
      const cleanSnippetValue = cleanText(row.snippet, 260);
      const titleTokens = tokenize(cleanTitle);
      const snippetTokens = tokenize(cleanSnippetValue);
      const domain = getDomain(row.url);
      let score = 0;
      score += sourceDomainBoost(domain);
      score += overlapScore(queryTokens, titleTokens) * 3;
      score += overlapScore(queryTokens, snippetTokens) * 2;
      if (!isLowValueSnippet(cleanSnippetValue)) {
        score += 8;
      } else {
        score -= 10;
      }
      if (row.source === "DuckDuckGo") {
        score += 2;
      }
      if (row.source === "Wikipedia") {
        score += 3;
      }
      return {
        ...row,
        title: cleanTitle,
        snippet: cleanSnippetValue,
        score
      };
    })
    .filter((row) => row.snippet.length >= 30 && row.score >= 8)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
};

const deriveKeyFacts = (sources: PublicWebSearchSource[]) => {
  const factCandidates: Array<{ text: string; sources: number; score: number }> = [];
  const sourceSentences = sources.map((source) => {
    return source.snippet
      .split(/[.;!?]/)
      .map((chunk) => cleanText(chunk, 220))
      .filter((chunk) => chunk.length >= 35 && chunk.length <= 220);
  });

  for (let i = 0; i < sourceSentences.length; i += 1) {
    for (const sentence of sourceSentences[i]) {
      const sentenceTokens = tokenize(sentence);
      let support = 1;
      for (let j = 0; j < sourceSentences.length; j += 1) {
        if (i === j) {
          continue;
        }
        const hasOverlap = sourceSentences[j].some((other) => {
          const overlap = overlapScore(sentenceTokens, tokenize(other));
          return overlap >= Math.max(3, Math.floor(sentenceTokens.length * 0.35));
        });
        if (hasOverlap) {
          support += 1;
        }
      }
      const score = support * 10 + Math.min(sentenceTokens.length, 16);
      factCandidates.push({
        text: sentence,
        sources: support,
        score
      });
    }
  }

  factCandidates.sort((a, b) => b.score - a.score);
  const unique = new Set<string>();
  const facts: string[] = [];
  for (const candidate of factCandidates) {
    const key = candidate.text.toLowerCase();
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    facts.push(candidate.text);
    if (facts.length >= 4) {
      break;
    }
  }
  return facts;
};

export const runPublicWebSearch = async (query: string): Promise<PublicWebSearchResult> => {
  const warnings: string[] = [];
  const settled = await Promise.allSettled([
    searchDuckDuckGo(query),
    searchWikipedia(query),
    searchWikipediaImages(query)
  ]);

  const [duckResult, wikipediaResult, imageResult] = settled;
  const duck = duckResult.status === "fulfilled" ? duckResult.value : null;
  if (duckResult.status === "rejected") {
    warnings.push(
      `DuckDuckGo unavailable: ${
        duckResult.reason instanceof Error ? duckResult.reason.message : "failed"
      }`
    );
  }
  const wikiSources = wikipediaResult.status === "fulfilled" ? wikipediaResult.value : [];
  if (wikipediaResult.status === "rejected") {
    warnings.push(
      `Wikipedia unavailable: ${
        wikipediaResult.reason instanceof Error ? wikipediaResult.reason.message : "failed"
      }`
    );
  }
  const images = imageResult.status === "fulfilled" ? imageResult.value : [];
  if (imageResult.status === "rejected") {
    warnings.push(
      `Image search unavailable: ${
        imageResult.reason instanceof Error ? imageResult.reason.message : "failed"
      }`
    );
  }

  const deduped = dedupeSources([...(duck?.sources ?? []), ...wikiSources]);
  const ranked = rankSources(query, deduped);
  const sources = ranked.slice(0, 5);
  const keyFacts = deriveKeyFacts(sources);
  const answerHint =
    cleanText(duck?.answerHint ?? "", 420) ||
    cleanText(keyFacts[0] ?? "", 420) ||
    cleanText(sources[0]?.snippet ?? "", 420) ||
    "";

  const filteredImages = isLikelyImageRelevant(query) ? images : [];

  return {
    ok: true,
    query,
    answer_hint: answerHint,
    sources,
    images: filteredImages,
    key_facts: keyFacts,
    warnings,
    fetched_at: nowIso()
  };
};
