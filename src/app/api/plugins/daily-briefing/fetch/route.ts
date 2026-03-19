/**
 * Daily Briefing - Fetch Route (v2)
 *
 * POST /api/plugins/daily-briefing/fetch
 * Fetches briefing items for all enabled needs (or a specific need).
 *
 * Body:
 *   { needId?: string }           — fetch for specific need, or all enabled
 *   { dryRun: true, strategy }    — test a strategy without saving
 */

import { NextRequest, NextResponse } from "next/server";
import { EnvHttpProxyAgent } from "undici";
import { aiInvoke } from "@/lib/ai-invoke";

// ---- Proxy-aware fetch ----
// Node.js native fetch ignores HTTP_PROXY/HTTPS_PROXY env vars.
// Use undici's EnvHttpProxyAgent to route through system proxy when configured.
let _proxyDispatcher: EnvHttpProxyAgent | undefined;
function getProxyDispatcher(): EnvHttpProxyAgent {
  if (!_proxyDispatcher) _proxyDispatcher = new EnvHttpProxyAgent();
  return _proxyDispatcher;
}
function hasProxyEnv(): boolean {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy);
}
function proxyFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  if (hasProxyEnv()) {
    return fetch(url, { ...init, dispatcher: getProxyDispatcher() } as RequestInit);
  }
  return fetch(url, init);
}
import {
  getNeeds,
  updateNeed,
  saveBriefing,
  getBriefing,
  getConfig,
} from "@/plugins/daily-briefing/lib/briefing-store";
import type {
  BriefingItem,
  DailyBriefing,
  InfoNeed,
  SearchStrategy,
  SourceConfig,
} from "@/plugins/daily-briefing/types";

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Generate an AI summary of briefing items using Claude CLI.
 */
async function generateSummary(
  items: BriefingItem[],
  language: "zh" | "en",
): Promise<string> {
  if (items.length === 0) return "";

  const topItems = items.slice(0, 20);
  const itemSummaries = topItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.sourceType}] ${item.title}\n   ${item.description.slice(0, 200)}`,
    )
    .join("\n\n");

  const langInstruction =
    language === "zh"
      ? "请用中文撰写简报摘要。"
      : "Write the briefing summary in English.";

  const prompt = `You are an AI briefing assistant. Generate a concise daily intelligence briefing from these items.

${langInstruction}

## Today's Items (${items.length} total, showing top ${topItems.length}):

${itemSummaries}

## Instructions:
1. Write a 3-5 paragraph executive summary highlighting the most important findings
2. Group related items into themes
3. Note any significant trends or patterns
4. Keep it concise but informative — this is a daily briefing, not an essay
5. Use bullet points for key takeaways
6. End with a "Key Takeaways" section (3-5 bullets)

Return the briefing text directly, no JSON wrapper.`;

  const result = await aiInvoke(prompt, { timeoutMs: 60000 });
  return result ?? "";
}

/**
 * Generate a shorter AI summary for a single need's items.
 */
async function generateNeedSummary(
  needName: string,
  items: BriefingItem[],
  language: "zh" | "en",
): Promise<string> {
  if (items.length === 0) return "";

  const topItems = items.slice(0, 15);
  const itemSummaries = topItems
    .map(
      (item, i) =>
        `${i + 1}. [${item.sourceType}] ${item.title}\n   ${item.description.slice(0, 150)}`,
    )
    .join("\n\n");

  const langInstruction =
    language === "zh"
      ? "请用中文撰写摘要。"
      : "Write the summary in English.";

  const prompt = `You are an AI briefing assistant. Generate a concise summary for the "${needName}" category.

${langInstruction}

## Items (${items.length} total, showing top ${topItems.length}):

${itemSummaries}

## Instructions:
1. Write 1-2 paragraphs summarizing the key findings for this category
2. Highlight the most notable items
3. Note any trends specific to this topic
4. End with 2-3 bullet point takeaways
5. Keep it brief — this is a category summary, not a full report

Return the summary text directly, no JSON wrapper.`;

  const result = await aiInvoke(prompt, { timeoutMs: 45000 });
  return result ?? "";
}

/** Overall request timeout (90 seconds) to prevent hanging */
const OVERALL_TIMEOUT_MS = 90_000;

export async function POST(req: NextRequest) {
  // Create an overall timeout controller for the entire request
  const overallController = new AbortController();
  const overallTimeout = setTimeout(() => overallController.abort(), OVERALL_TIMEOUT_MS);

  try {
    const body = await req.json();
    const { needId, dryRun, strategy: dryRunStrategy } = body;

    // Dry run mode: test a strategy without saving
    if (dryRun && dryRunStrategy) {
      const items = await fetchForStrategy(
        dryRunStrategy as SearchStrategy,
        "dry-run",
      );
      return NextResponse.json({ items, count: items.length });
    }

    // Normal mode: fetch for enabled needs
    const allNeeds = getNeeds();
    const targetNeeds = needId
      ? allNeeds.filter((n) => n.id === needId)
      : allNeeds.filter((n) => n.enabled);

    if (targetNeeds.length === 0) {
      return NextResponse.json({
        briefing: null,
        count: 0,
        message: "No enabled needs to fetch",
      });
    }

    const allItems: BriefingItem[] = [];
    const errors: string[] = [];

    // Fetch for each need in parallel
    const fetchers = targetNeeds.map(async (need) => {
      try {
        const items = await fetchForStrategy(need.strategy, need.id);
        // Tag items with need tags
        const taggedItems = items.map((item) => ({
          ...item,
          tags: [...new Set([...item.tags, ...need.tags])],
        }));
        allItems.push(...taggedItems);

        // Update lastFetchedAt
        updateNeed(need.id, { lastFetchedAt: new Date().toISOString() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`${need.name}: ${msg}`);
      }
    });

    await Promise.allSettled(fetchers);

    // Sort by relevance then date
    allItems.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return (
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
    });

    // Build stats
    const byNeed: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const item of allItems) {
      byNeed[item.needId] = (byNeed[item.needId] ?? 0) + 1;
      bySource[item.sourceType] = (bySource[item.sourceType] ?? 0) + 1;
    }

    const date = todayStr();

    // Merge with existing briefing (preserve user feedback)
    const existing = getBriefing(date);
    const existingMap = new Map(
      (existing?.items ?? []).map((i) => [i.id, i]),
    );
    const mergedItems = allItems.map((item) => {
      const prev = existingMap.get(item.id);
      return prev
        ? {
            ...item,
            isRead: prev.isRead,
            isFavorite: prev.isFavorite,
            userFeedback: prev.userFeedback,
          }
        : item;
    });

    // Generate AI summaries (global + per-need in parallel)
    const userConfig = getConfig();
    const summaryLang: "zh" | "en" =
      (userConfig?.summaryLanguage as "zh" | "en") ?? "en";

    // Group items by needId for per-need summaries
    const itemsByNeed = new Map<string, BriefingItem[]>();
    for (const item of mergedItems) {
      const existing = itemsByNeed.get(item.needId) ?? [];
      itemsByNeed.set(item.needId, [...existing, item]);
    }

    // Build a needId -> needName lookup
    const needNameMap = new Map<string, string>();
    for (const need of targetNeeds) {
      needNameMap.set(need.id, need.name);
    }

    // Generate global summary + per-need summaries in parallel
    const needIdsForSummary = [...itemsByNeed.entries()]
      .filter(([, items]) => items.length >= 3)
      .map(([needId]) => needId);

    const summaryPromises: Promise<{ key: string; summary: string }>[] = [
      generateSummary(mergedItems, summaryLang).then((s) => ({
        key: "__global__",
        summary: s,
      })),
      ...needIdsForSummary.map((nid) =>
        generateNeedSummary(
          needNameMap.get(nid) ?? nid,
          itemsByNeed.get(nid) ?? [],
          summaryLang,
        ).then((s) => ({ key: nid, summary: s })),
      ),
    ];

    const summaryResults = await Promise.allSettled(summaryPromises);

    let globalSummary = "";
    const perNeedSummaries: Record<string, string> = {};

    for (const result of summaryResults) {
      if (result.status === "fulfilled" && result.value.summary) {
        if (result.value.key === "__global__") {
          globalSummary = result.value.summary;
        } else {
          perNeedSummaries[result.value.key] = result.value.summary;
        }
      }
    }

    const briefing: DailyBriefing = {
      date,
      items: mergedItems,
      summary: globalSummary || undefined,
      summaries:
        Object.keys(perNeedSummaries).length > 0
          ? perNeedSummaries
          : undefined,
      summaryLanguage: globalSummary ? summaryLang : undefined,
      summaryGeneratedAt: globalSummary
        ? new Date().toISOString()
        : undefined,
      stats: {
        total: mergedItems.length,
        byNeed,
        bySource,
      },
    };

    saveBriefing(briefing);

    return NextResponse.json({
      briefing,
      count: mergedItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out. The briefing fetch took too long." },
        { status: 504 }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(overallTimeout);
  }
}

/**
 * Fetch items for a given search strategy.
 */
async function fetchForStrategy(
  strategy: SearchStrategy,
  needId: string,
): Promise<BriefingItem[]> {
  const allItems: BriefingItem[] = [];

  const fetchers = strategy.sources.map(async (source) => {
    try {
      const items = await fetchFromSource(source, strategy.keywords, needId);
      allItems.push(...items);
    } catch (err) {
      console.error(
        `[Briefing] Error fetching from ${source.type}:`,
        err,
      );
    }
  });

  await Promise.allSettled(fetchers);

  // Score relevance based on keyword matching
  const scored = allItems.map((item) => ({
    ...item,
    relevanceScore: scoreRelevance(item, strategy.keywords),
  }));

  // Apply filters
  const filtered = applyFilters(scored, strategy.filters);

  return filtered;
}

/**
 * Fetch from a specific source.
 */
async function fetchFromSource(
  source: SourceConfig,
  keywords: string[],
  needId: string,
): Promise<BriefingItem[]> {
  switch (source.type) {
    case "github":
      return fetchGitHub(keywords, needId, source);
    case "arxiv":
      return fetchArxiv(keywords, needId, source);
    case "huggingface":
      return fetchHuggingFace(needId);
    case "rss":
      return fetchRSS(source, needId);
    case "web-search":
      return fetchWebSearch(keywords, needId, source);
    case "rsshub":
      return fetchRSSHub(source, needId);
    case "youtube":
      return fetchYouTube(source, needId);
    case "finance":
      return fetchFinance(source, needId);
    case "custom-api":
      return fetchCustomAPI(source, needId);
    default:
      return [];
  }
}

// ---- GitHub ----

async function fetchGitHub(
  keywords: string[],
  needId: string,
  source: SourceConfig,
): Promise<BriefingItem[]> {
  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - 7);
  const dateStr = dateThreshold.toISOString().slice(0, 10);

  const keywordQuery = keywords.join("+");
  const query = `${keywordQuery}+created:>${dateStr}+stars:>10`;
  const perPage = source.config.per_page ?? "20";
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`;

  const res = await proxyFetch(url, {
    headers: { Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

  const data = await res.json();
  const repos = data.items ?? [];

  return repos.map(
    (repo: {
      id: number;
      full_name: string;
      html_url: string;
      description: string | null;
      owner: { login: string };
      stargazers_count: number;
      language: string | null;
      topics: string[];
      created_at: string;
    }) => ({
      id: `gh-${repo.id}`,
      needId,
      source: "GitHub",
      sourceType: "github" as const,
      title: repo.full_name,
      url: repo.html_url,
      description: repo.description ?? "",
      author: repo.owner?.login,
      publishedAt: repo.created_at,
      tags: (repo.topics ?? []).slice(0, 5),
      relevanceScore: 0,
      isRead: false,
      isFavorite: false,
      stars: repo.stargazers_count,
      language: repo.language ?? undefined,
      // GitHub's deterministic OG image service — no API call needed
      thumbnail: `https://opengraph.githubassets.com/1/${repo.full_name}`,
    }),
  );
}

// ---- ArXiv ----

async function fetchArxiv(
  keywords: string[],
  needId: string,
  source: SourceConfig,
): Promise<BriefingItem[]> {
  const categories = source.config.categories ?? "cs.AI";
  const catParts = categories.split(",").map((c) => c.trim());
  const catQuery = catParts.map((c) => `cat:${c}`).join("+OR+");
  const keywordQuery = keywords.length > 0
    ? `+AND+all:${keywords.join("+OR+all:")}`
    : "";

  const url = `https://export.arxiv.org/api/query?search_query=${catQuery}${keywordQuery}&sortBy=submittedDate&sortOrder=descending&max_results=20`;

  const res = await proxyFetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`ArXiv API returned ${res.status}`);

  const xml = await res.text();
  const items: BriefingItem[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null && items.length < 20) {
    const block = match[1];
    const title = extractTag(block, "title").replace(/\s+/g, " ");
    const summary = extractTag(block, "summary").replace(/\s+/g, " ");
    const published = extractTag(block, "published");
    const id = extractTag(block, "id");
    const authorName = extractTag(block, "name");

    const catRegex = /category[^>]*term="([^"]+)"/gi;
    const tags: string[] = [];
    let catMatch: RegExpExecArray | null;
    while ((catMatch = catRegex.exec(block)) !== null) {
      tags.push(catMatch[1]);
    }

    if (!title) continue;

    items.push({
      id: `arxiv-${hashCode(id || title)}`,
      needId,
      source: "arXiv",
      sourceType: "arxiv",
      title,
      url: id || `https://arxiv.org/abs/${hashCode(title)}`,
      description: summary,
      author: authorName || undefined,
      publishedAt: published
        ? new Date(published).toISOString()
        : new Date().toISOString(),
      tags: tags.slice(0, 4),
      relevanceScore: 0,
      isRead: false,
      isFavorite: false,
    });
  }

  return items;
}

// ---- HuggingFace ----

async function fetchHuggingFace(needId: string): Promise<BriefingItem[]> {
  const res = await proxyFetch("https://huggingface.co/api/daily_papers", {
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`HuggingFace API returned ${res.status}`);

  const papers = await res.json();
  if (!Array.isArray(papers)) return [];

  return papers.slice(0, 20).map(
    (
      paper: {
        title?: string;
        thumbnail?: string;
        paper?: {
          id?: string;
          title?: string;
          summary?: string;
          authors?: { name?: string }[];
          githubRepo?: string;
          ai_keywords?: string[];
          upvotes?: number;
        };
        publishedAt?: string;
      },
      idx: number,
    ) => {
      const paperId = paper.paper?.id ?? `hf-${idx}`;
      const aiKeywords = paper.paper?.ai_keywords ?? [];
      return {
        id: `hf-${paperId}`,
        needId,
        source: "HuggingFace",
        sourceType: "huggingface" as const,
        title: paper.paper?.title ?? paper.title ?? "Untitled",
        url: `https://huggingface.co/papers/${paperId}`,
        description: paper.paper?.summary ?? "",
        author: paper.paper?.authors?.[0]?.name,
        publishedAt: paper.publishedAt ?? new Date().toISOString(),
        tags: aiKeywords.length > 0 ? aiKeywords : ["paper", "ml"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail: paper.thumbnail,
        githubUrl: paper.paper?.githubRepo,
        upvotes: paper.paper?.upvotes ?? 0,
        aiKeywords,
      };
    },
  );
}

// ---- RSS ----

/**
 * Extract og:image from an HTML page.
 * Returns the image URL or undefined if not found / request fails.
 */
async function extractOgImage(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await proxyFetch(pageUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    });
    if (!res.ok) return undefined;

    // Read only the first 50KB to find the og:image meta tag (always in <head>)
    const reader = res.body?.getReader();
    if (!reader) return undefined;

    let html = "";
    const decoder = new TextDecoder();
    while (html.length < 50_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});

    // Match <meta property="og:image" content="...">
    const ogMatch = /meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html)
      || /meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
    return ogMatch?.[1] || undefined;
  } catch {
    return undefined;
  }
}

async function fetchRSS(
  source: SourceConfig,
  needId: string,
): Promise<BriefingItem[]> {
  const feedUrl = source.config.url;
  if (!feedUrl) return [];

  const allItems: BriefingItem[] = [];

  try {
    const res = await proxyFetch(feedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
    let match: RegExpExecArray | null;

    while (
      (match = itemRegex.exec(xml)) !== null &&
      allItems.length < 20
    ) {
      const block = match[1];
      const title = extractTag(block, "title");
      const link =
        extractTag(block, "link") || extractAttr(block, "link", "href");
      const description =
        extractTag(block, "description") ||
        extractTag(block, "summary") ||
        extractTag(block, "content");
      const pubDate =
        extractTag(block, "pubDate") ||
        extractTag(block, "published") ||
        extractTag(block, "updated");
      const author =
        extractTag(block, "author") || extractTag(block, "dc:creator");

      // Try to extract image from RSS feed content itself
      // (media:content, media:thumbnail, enclosure with image type)
      const mediaUrl =
        extractAttr(block, "media:content", "url") ||
        extractAttr(block, "media:thumbnail", "url") ||
        extractImageEnclosure(block);

      if (!title) continue;

      allItems.push({
        id: `rss-${hashCode(feedUrl + title)}`,
        needId,
        source: source.name,
        sourceType: "rss",
        title: stripHtml(title),
        url: link || feedUrl,
        description: stripHtml(description).slice(0, 1000),
        author: author ? stripHtml(author) : undefined,
        publishedAt: pubDate
          ? new Date(pubDate).toISOString()
          : new Date().toISOString(),
        tags: ["rss"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail: mediaUrl || undefined,
      });
    }
  } catch {
    // Skip failed feeds
  }

  // Enrich top items (without thumbnails) with og:image from their pages
  const itemsNeedingThumbnails = allItems
    .filter((item) => !item.thumbnail && item.url)
    .slice(0, 5);

  if (itemsNeedingThumbnails.length > 0) {
    const ogResults = await Promise.allSettled(
      itemsNeedingThumbnails.map(async (item) => {
        const ogImage = await extractOgImage(item.url);
        return { id: item.id, ogImage };
      }),
    );

    const ogMap = new Map<string, string>();
    for (const result of ogResults) {
      if (result.status === "fulfilled" && result.value.ogImage) {
        ogMap.set(result.value.id, result.value.ogImage);
      }
    }

    // Apply og:image thumbnails to items
    for (const item of allItems) {
      if (!item.thumbnail && ogMap.has(item.id)) {
        item.thumbnail = ogMap.get(item.id);
      }
    }
  }

  return allItems;
}

// ---- Web Search (DuckDuckGo + Bing fallback) ----

async function fetchWebSearch(
  keywords: string[],
  needId: string,
  source: SourceConfig,
): Promise<BriefingItem[]> {
  const query = source.config.query || keywords.join(" ");

  // Try Bing first if API key is configured (works in China without proxy)
  const bingApiKey = source.config.bingApiKey || process.env.BING_SEARCH_API_KEY;
  if (bingApiKey) {
    const bingItems = await fetchBingSearch(query, needId, bingApiKey);
    if (bingItems.length > 0) return bingItems;
  }

  // Fallback to DuckDuckGo Instant Answer API (free, no auth required)
  // Note: DuckDuckGo may be blocked in some regions (e.g., China)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    const items: BriefingItem[] = [];

    // Process related topics
    const topics: { Text?: string; FirstURL?: string; Topics?: { Text?: string; FirstURL?: string }[] }[] =
      [...(data.RelatedTopics ?? [])];

    for (const topic of topics.slice(0, 15)) {
      if (topic.Text && topic.FirstURL) {
        items.push({
          id: `ws-${hashCode(topic.FirstURL)}`,
          needId,
          source: "Web Search",
          sourceType: "web-search",
          title: topic.Text.split(" - ")[0] || topic.Text.slice(0, 100),
          url: topic.FirstURL,
          description: topic.Text,
          publishedAt: new Date().toISOString(),
          tags: ["web-search"],
          relevanceScore: 0,
          isRead: false,
          isFavorite: false,
        });
      }
      // Handle nested sub-topics
      if (topic.Topics) {
        for (const sub of topic.Topics.slice(0, 5)) {
          if (sub.Text && sub.FirstURL) {
            items.push({
              id: `ws-${hashCode(sub.FirstURL)}`,
              needId,
              source: "Web Search",
              sourceType: "web-search",
              title: sub.Text.split(" - ")[0] || sub.Text.slice(0, 100),
              url: sub.FirstURL,
              description: sub.Text,
              publishedAt: new Date().toISOString(),
              tags: ["web-search"],
              relevanceScore: 0,
              isRead: false,
              isFavorite: false,
            });
          }
        }
      }
    }

    // Also include AbstractText if available (main topic summary)
    if (data.AbstractText && data.AbstractURL) {
      items.unshift({
        id: `ws-${hashCode(data.AbstractURL)}`,
        needId,
        source: "Web Search",
        sourceType: "web-search",
        title: data.Heading || query,
        url: data.AbstractURL,
        description: data.AbstractText,
        publishedAt: new Date().toISOString(),
        tags: ["web-search", "summary"],
        relevanceScore: 0.9,
        isRead: false,
        isFavorite: false,
      });
    }

    if (items.length > 0) return items;
  } catch {
    // DuckDuckGo failed (likely blocked), continue to Bing CN fallback
  }

  // Last resort: Bing CN web search (no API key, scrape-like via Bing suggestions)
  // This is a basic fallback that returns minimal results
  return [];
}

/**
 * Bing Web Search API v7 (works in China without proxy).
 * Requires BING_SEARCH_API_KEY env var or bingApiKey in source config.
 * Free tier: 1000 calls/month at https://www.microsoft.com/en-us/bing/apis/bing-web-search-api
 */
async function fetchBingSearch(
  query: string,
  needId: string,
  apiKey: string,
): Promise<BriefingItem[]> {
  try {
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=15&mkt=en-US`;
    const res = await proxyFetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    });
    if (!res.ok) return [];

    const data = await res.json();
    const webPages = data.webPages?.value ?? [];
    const items: BriefingItem[] = [];

    for (const page of webPages.slice(0, 15)) {
      if (!page.name || !page.url) continue;
      items.push({
        id: `ws-bing-${hashCode(page.url)}`,
        needId,
        source: "Bing Search",
        sourceType: "web-search",
        title: page.name,
        url: page.url,
        description: page.snippet ?? "",
        publishedAt: page.dateLastCrawled
          ? new Date(page.dateLastCrawled).toISOString()
          : new Date().toISOString(),
        tags: ["web-search", "bing"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail: page.thumbnailUrl ?? undefined,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// ---- RSSHub ----

async function fetchRSSHub(
  source: SourceConfig,
  needId: string,
): Promise<BriefingItem[]> {
  const route = source.config.route;
  if (!route) return [];

  const baseUrl = source.config.baseUrl || "https://rsshub.app";
  // Public RSSHub mirrors to try if the primary is blocked/rate-limited
  const RSSHUB_MIRRORS = [
    baseUrl,
    "https://rsshub.rssforever.com",
    "https://rsshub-instance.zeabur.app",
  ];

  // Deduplicate mirrors (in case baseUrl is already one of them)
  const uniqueMirrors = [...new Set(RSSHUB_MIRRORS)];

  for (const mirror of uniqueMirrors) {
    const feedUrl = `${mirror}${route.startsWith("/") ? route : `/${route}`}`;
    try {
      const res = await proxyFetch(feedUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;

      const xml = await res.text();
      const items: BriefingItem[] = [];
      const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
      let match: RegExpExecArray | null;

      while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
        const block = match[1];
        const title = extractTag(block, "title");
        const link =
          extractTag(block, "link") || extractAttr(block, "link", "href");
        const description =
          extractTag(block, "description") ||
          extractTag(block, "summary") ||
          extractTag(block, "content");
        const pubDate =
          extractTag(block, "pubDate") ||
          extractTag(block, "published") ||
          extractTag(block, "updated");
        const author =
          extractTag(block, "author") || extractTag(block, "dc:creator");

        // Extract images: media:content, enclosure, or img tags in description
        const mediaUrl =
          extractAttr(block, "media:content", "url") ||
          extractAttr(block, "media:thumbnail", "url") ||
          extractImageEnclosure(block) ||
          extractImgFromHtml(description);

        if (!title) continue;

        items.push({
          id: `rsshub-${hashCode(route + title)}`,
          needId,
          source: source.name || "RSSHub",
          sourceType: "rsshub",
          title: stripHtml(title),
          url: link || feedUrl,
          description: stripHtml(description).slice(0, 1000),
          author: author ? stripHtml(author) : undefined,
          publishedAt: pubDate
            ? new Date(pubDate).toISOString()
            : new Date().toISOString(),
          tags: ["rsshub"],
          relevanceScore: 0,
          isRead: false,
          isFavorite: false,
          thumbnail: mediaUrl || undefined,
        });
      }

      if (items.length > 0) return items;
    } catch {
      // This mirror failed, try next
      continue;
    }
  }

  return [];
}

/** Extract the first <img src="..."> URL from HTML content */
function extractImgFromHtml(html: string): string {
  const match = /<img[^>]+src="([^"]+)"/i.exec(html);
  return match ? match[1] : "";
}

// ---- YouTube ----

async function fetchYouTube(
  source: SourceConfig,
  needId: string,
): Promise<BriefingItem[]> {
  const channelId = source.config.channelId;
  const playlistId = source.config.playlistId;

  if (!channelId && !playlistId) return [];

  const feedUrl = channelId
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    : `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;

  try {
    const res = await proxyFetch(feedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const items: BriefingItem[] = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(xml)) !== null && items.length < 20) {
      const block = match[1];
      const title = extractTag(block, "title");
      const videoId = extractTag(block, "yt:videoId");
      const link = extractAttr(block, "link", "href");
      const published = extractTag(block, "published");
      const authorName = extractTag(block, "name");
      const description =
        extractTag(block, "media:description") ||
        extractTag(block, "content");

      if (!title || !videoId) continue;

      items.push({
        id: `yt-${videoId}`,
        needId,
        source: source.name || "YouTube",
        sourceType: "youtube",
        title: stripHtml(title),
        url: link || `https://www.youtube.com/watch?v=${videoId}`,
        description: stripHtml(description).slice(0, 1000),
        author: authorName ? stripHtml(authorName) : undefined,
        publishedAt: published
          ? new Date(published).toISOString()
          : new Date().toISOString(),
        tags: ["youtube", "video"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// ---- Finance/Stock News ----

async function fetchFinance(
  source: SourceConfig,
  needId: string,
): Promise<BriefingItem[]> {
  const finnhubToken = source.config.finnhubToken;
  const symbols = source.config.symbols;

  // With Finnhub token: use their API
  if (finnhubToken) {
    return fetchFinnhub(finnhubToken, symbols, needId, source);
  }

  // Without token: fallback to Yahoo Finance RSS
  return fetchYahooFinanceRSS(needId, source);
}

async function fetchFinnhub(
  token: string,
  symbols: string | undefined,
  needId: string,
  source: SourceConfig,
): Promise<BriefingItem[]> {
  const items: BriefingItem[] = [];

  try {
    if (symbols) {
      // Fetch company-specific news for each symbol
      const symbolList = symbols.split(",").map((s) => s.trim()).slice(0, 5);
      const today = new Date().toISOString().slice(0, 10);
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      const fetchers = symbolList.map(async (symbol) => {
        const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${weekAgo}&to=${today}&token=${token}`;
        const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data.slice(0, 5) : [];
      });

      const results = await Promise.allSettled(fetchers);
      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const article of result.value) {
            items.push(finnhubArticleToBriefingItem(article, needId, source));
          }
        }
      }
    } else {
      // General market news
      const url = `https://finnhub.io/api/v1/news?category=general&token=${token}`;
      const res = await proxyFetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      for (const article of data.slice(0, 20)) {
        items.push(finnhubArticleToBriefingItem(article, needId, source));
      }
    }
  } catch {
    return [];
  }

  return items;
}

function finnhubArticleToBriefingItem(
  article: {
    id?: number;
    headline?: string;
    url?: string;
    summary?: string;
    source?: string;
    datetime?: number;
    image?: string;
    related?: string;
  },
  needId: string,
  source: SourceConfig,
): BriefingItem {
  const publishedAt = article.datetime
    ? new Date(article.datetime * 1000).toISOString()
    : new Date().toISOString();

  return {
    id: `fin-${article.id ?? hashCode((source.name || "finnhub") + (article.url ?? "") + (article.headline ?? ""))}`,
    needId,
    source: source.name || article.source || "Finance",
    sourceType: "finance",
    title: article.headline ?? "Untitled",
    url: article.url ?? "",
    description: article.summary ?? "",
    author: article.source,
    publishedAt,
    tags: [
      "finance",
      ...(article.related ? article.related.split(",").slice(0, 3) : []),
    ],
    relevanceScore: 0,
    isRead: false,
    isFavorite: false,
    thumbnail: article.image || undefined,
  };
}

async function fetchYahooFinanceRSS(
  needId: string,
  source: SourceConfig,
): Promise<BriefingItem[]> {
  try {
    const feedUrl = "https://finance.yahoo.com/news/rssindex";
    const res = await proxyFetch(feedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const items: BriefingItem[] = [];
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
      const block = match[1];
      const title = extractTag(block, "title");
      const link = extractTag(block, "link");
      const description = extractTag(block, "description");
      const pubDate = extractTag(block, "pubDate");

      const mediaUrl =
        extractAttr(block, "media:content", "url") ||
        extractAttr(block, "media:thumbnail", "url") ||
        extractImageEnclosure(block);

      if (!title) continue;

      items.push({
        id: `fin-yf-${hashCode(link || title)}`,
        needId,
        source: source.name || "Yahoo Finance",
        sourceType: "finance",
        title: stripHtml(title),
        url: link || feedUrl,
        description: stripHtml(description).slice(0, 1000),
        publishedAt: pubDate
          ? new Date(pubDate).toISOString()
          : new Date().toISOString(),
        tags: ["finance", "yahoo"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail: mediaUrl || undefined,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// ---- Custom API ----

async function fetchCustomAPI(
  source: SourceConfig,
  needId: string,
): Promise<BriefingItem[]> {
  const url = source.config.url;
  if (!url) return [];

  const method = (source.config.method || "GET").toUpperCase();
  const itemsPath = source.config.itemsPath || "";
  const mappingStr = source.config.mapping || "{}";

  let headers: Record<string, string> = {};
  try {
    headers = source.config.headers ? JSON.parse(source.config.headers) : {};
  } catch {
    // Invalid headers JSON, use empty
  }

  let mapping: Record<string, string> = {};
  try {
    mapping = JSON.parse(mappingStr);
  } catch {
    // Invalid mapping JSON, use empty
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      signal: AbortSignal.timeout(10000),
    };

    const res = await proxyFetch(url, fetchOptions);
    if (!res.ok) return [];

    const data = await res.json();

    // Navigate to itemsPath (e.g., "data.items" or "results")
    let items: unknown[] = [];
    if (itemsPath) {
      let current: unknown = data;
      for (const key of itemsPath.split(".")) {
        if (current && typeof current === "object" && key in current) {
          current = (current as Record<string, unknown>)[key];
        } else {
          current = undefined;
          break;
        }
      }
      items = Array.isArray(current) ? current : [];
    } else {
      items = Array.isArray(data) ? data : [];
    }

    return items.slice(0, 20).map((item, idx) => {
      const record = (typeof item === "object" && item !== null)
        ? item as Record<string, unknown>
        : {};

      const getValue = (mappingKey: string): string => {
        const field = mapping[mappingKey];
        if (!field) return "";
        // Support nested paths like "meta.title"
        let current: unknown = record;
        for (const key of field.split(".")) {
          if (current && typeof current === "object" && key in current) {
            current = (current as Record<string, unknown>)[key];
          } else {
            return "";
          }
        }
        return typeof current === "string" ? current : String(current ?? "");
      };

      const title = getValue("title") || `Item ${idx + 1}`;
      const itemUrl = getValue("url") || url;
      const description = getValue("description") || "";
      const thumbnail = getValue("thumbnail") || undefined;
      const publishedAt = getValue("publishedAt");

      return {
        id: `capi-${hashCode(url + title + idx)}`,
        needId,
        source: source.name || "Custom API",
        sourceType: "custom-api" as const,
        title,
        url: itemUrl,
        description: description.slice(0, 1000),
        publishedAt: publishedAt
          ? new Date(publishedAt).toISOString()
          : new Date().toISOString(),
        tags: ["custom-api"],
        relevanceScore: 0,
        isRead: false,
        isFavorite: false,
        thumbnail,
      };
    });
  } catch {
    return [];
  }
}

// ---- Relevance Scoring ----

function scoreRelevance(item: BriefingItem, keywords: string[]): number {
  if (keywords.length === 0) return 0.5;

  const text = `${item.title} ${item.description} ${item.tags.join(" ")}`.toLowerCase();
  let matches = 0;

  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) {
      matches++;
    }
  }

  return Math.min(1, matches / Math.max(1, keywords.length));
}

// ---- Filter application ----

function applyFilters(
  items: BriefingItem[],
  filters: { field: string; operator: string; value: string }[],
): BriefingItem[] {
  if (filters.length === 0) return items;

  return items.filter((item) => {
    return filters.every((filter) => {
      const fieldValue = getFieldValue(item, filter.field);
      switch (filter.operator) {
        case "contains":
          return fieldValue.toLowerCase().includes(filter.value.toLowerCase());
        case "not-contains":
          return !fieldValue.toLowerCase().includes(filter.value.toLowerCase());
        case "regex":
          try {
            // ReDoS protection: reject overly long patterns
            if (filter.value.length > 200) {
              console.warn("[Briefing] Regex filter too long, skipping:", filter.value.slice(0, 50));
              return true;
            }
            const regex = new RegExp(filter.value, "i");
            // Execute with a bounded input to prevent catastrophic backtracking
            const testInput = fieldValue.slice(0, 10_000);
            return regex.test(testInput);
          } catch {
            return true;
          }
        case "date-after":
          return new Date(fieldValue) > new Date(filter.value);
        default:
          return true;
      }
    });
  });
}

function getFieldValue(item: BriefingItem, field: string): string {
  switch (field) {
    case "title":
      return item.title;
    case "description":
      return item.description;
    case "author":
      return item.author ?? "";
    case "publishedAt":
      return item.publishedAt;
    case "source":
      return item.source;
    default:
      return "";
  }
}

// ---- XML Helpers ----

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`,
    "i",
  );
  const m = regex.exec(xml);
  return m ? m[1].trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const m = regex.exec(xml);
  return m ? m[1] : "";
}

/** Extract image URL from RSS <enclosure> tag with image MIME type */
function extractImageEnclosure(xml: string): string {
  const match = /<enclosure[^>]+type="image\/[^"]*"[^>]+url="([^"]*)"/.exec(xml)
    || /<enclosure[^>]+url="([^"]*)"[^>]+type="image\/[^"]*"/.exec(xml);
  return match ? match[1] : "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, " ")
    .trim();
}

function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
