const SEARCH_TIMEOUT_MS = 12_000;

export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at?: string;
}

export interface WebSearchImage {
  title: string;
  image_url: string;
  source_url: string;
}

export interface WebSearchResult {
  query: string;
  answer_hint: string;
  sources: WebSearchSource[];
  images: WebSearchImage[];
  warnings: string[];
  fetched_at: string;
}

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

const safeDecode = (value: string) => {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

const cleanText = (value: string, maxLength = 240) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const fetchWithTimeout = async (url: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const collectDuckDuckGoRelated = (topics: DuckDuckGoTopic[] = []): WebSearchSource[] => {
  const results: WebSearchSource[] = [];
  for (const topic of topics) {
    if (topic.FirstURL && topic.Text) {
      const title = cleanText(topic.Text.split(" - ")[0] ?? topic.Text, 90);
      results.push({
        title,
        url: topic.FirstURL,
        snippet: cleanText(topic.Text, 220),
        source: "DuckDuckGo"
      });
    }
    if (topic.Topics && topic.Topics.length > 0) {
      results.push(...collectDuckDuckGoRelated(topic.Topics));
    }
  }
  return results;
};

const fetchDuckDuckGo = async (query: string) => {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    "&format=json&no_html=1&skip_disambig=1";
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed (${response.status})`);
  }
  const payload = (await response.json()) as DuckDuckGoResponse;
  const sources: WebSearchSource[] = [];
  const answerHint = cleanText(payload.AbstractText ?? "", 420);
  if (payload.AbstractURL && payload.AbstractText) {
    sources.push({
      title: cleanText(payload.Heading ?? query, 90),
      url: payload.AbstractURL,
      snippet: cleanText(payload.AbstractText, 220),
      source: "DuckDuckGo"
    });
  }
  sources.push(...collectDuckDuckGoRelated(payload.RelatedTopics ?? []));
  return {
    answerHint,
    sources
  };
};

const fetchWikipediaSources = async (query: string): Promise<WebSearchSource[]> => {
  const url =
    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    "&limit=6&namespace=0&format=json";
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Wikipedia search failed (${response.status})`);
  }
  const payload = (await response.json()) as [string, string[], string[], string[]];
  const titles = payload[1] ?? [];
  const descriptions = payload[2] ?? [];
  const links = payload[3] ?? [];
  return titles.map((title, index) => ({
    title: cleanText(title, 90),
    url: links[index] ?? "",
    snippet: cleanText(descriptions[index] ?? title, 220),
    source: "Wikipedia"
  }));
};

const extractTag = (xmlChunk: string, tag: string): string => {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xmlChunk.match(regex);
  return safeDecode(match?.[1] ?? "");
};

const fetchGoogleNews = async (query: string): Promise<WebSearchSource[]> => {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    "&hl=en-US&gl=US&ceid=US:en";
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Google News RSS failed (${response.status})`);
  }
  const xml = await response.text();
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).map((match) => match[1]);
  return items.slice(0, 4).map((item) => ({
    title: cleanText(extractTag(item, "title"), 100),
    url: extractTag(item, "link"),
    snippet: cleanText(extractTag(item, "description"), 220),
    source: "Google News",
    published_at: extractTag(item, "pubDate")
  }));
};

const fetchWikipediaImages = async (query: string): Promise<WebSearchImage[]> => {
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search" +
    `&gsrsearch=${encodeURIComponent(query)}` +
    "&gsrlimit=6&prop=pageimages|info&inprop=url&pithumbsize=640&format=json";
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Wikipedia image search failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          fullurl?: string;
          thumbnail?: { source?: string };
        }
      >;
    };
  };
  const pages = Object.values(payload.query?.pages ?? {});
  return pages
    .filter((page) => page.thumbnail?.source && page.fullurl)
    .slice(0, 4)
    .map((page) => ({
      title: cleanText(page.title ?? "Image", 90),
      image_url: page.thumbnail?.source ?? "",
      source_url: page.fullurl ?? ""
    }));
};

const uniqueByUrl = <T extends { url: string }>(rows: T[]) => {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const row of rows) {
    if (!row.url || seen.has(row.url)) {
      continue;
    }
    seen.add(row.url);
    deduped.push(row);
  }
  return deduped;
};

export const runWebSearch = async (query: string): Promise<WebSearchResult> => {
  const warnings: string[] = [];
  const settled = await Promise.allSettled([
    fetchDuckDuckGo(query),
    fetchWikipediaSources(query),
    fetchGoogleNews(query),
    fetchWikipediaImages(query)
  ]);

  const [duckResult, wikipediaResult, newsResult, imageResult] = settled;

  const duck = duckResult.status === "fulfilled" ? duckResult.value : null;
  if (duckResult.status === "rejected") {
    warnings.push(`DuckDuckGo unavailable: ${duckResult.reason instanceof Error ? duckResult.reason.message : "failed"}`);
  }

  const wikiSources = wikipediaResult.status === "fulfilled" ? wikipediaResult.value : [];
  if (wikipediaResult.status === "rejected") {
    warnings.push(`Wikipedia unavailable: ${wikipediaResult.reason instanceof Error ? wikipediaResult.reason.message : "failed"}`);
  }

  const newsSources = newsResult.status === "fulfilled" ? newsResult.value : [];
  if (newsResult.status === "rejected") {
    warnings.push(`Google News unavailable: ${newsResult.reason instanceof Error ? newsResult.reason.message : "failed"}`);
  }

  const images = imageResult.status === "fulfilled" ? imageResult.value : [];
  if (imageResult.status === "rejected") {
    warnings.push(`Image search unavailable: ${imageResult.reason instanceof Error ? imageResult.reason.message : "failed"}`);
  }

  const combinedSources = uniqueByUrl([
    ...(duck?.sources ?? []),
    ...wikiSources,
    ...newsSources
  ]).slice(0, 9);

  const answerHint =
    duck?.answerHint && duck.answerHint.length > 0
      ? duck.answerHint
      : combinedSources[0]?.snippet ?? "";

  return {
    query,
    answer_hint: answerHint,
    sources: combinedSources,
    images,
    warnings,
    fetched_at: nowIso()
  };
};
