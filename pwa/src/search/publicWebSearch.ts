export interface PublicWebSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
  published_at?: string;
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

const cleanText = (value: string, maxLength = 240) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
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
  const deduped: PublicWebSearchSource[] = [];
  for (const row of rows) {
    if (!row.url || seen.has(row.url)) {
      continue;
    }
    seen.add(row.url);
    deduped.push(row);
  }
  return deduped;
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

  const sources = dedupeSources([...(duck?.sources ?? []), ...wikiSources]).slice(0, 8);
  const answerHint =
    cleanText(duck?.answerHint ?? "", 420) ||
    cleanText(sources[0]?.snippet ?? "", 420) ||
    "";

  return {
    ok: true,
    query,
    answer_hint: answerHint,
    sources,
    images,
    warnings,
    fetched_at: nowIso()
  };
};
