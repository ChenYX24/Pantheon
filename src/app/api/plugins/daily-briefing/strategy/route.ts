/**
 * Daily Briefing - Strategy Route (v2)
 *
 * POST /api/plugins/daily-briefing/strategy
 * Generates a search strategy from a user description using Claude AI.
 * Falls back to enhanced heuristic when Claude CLI is unavailable.
 */

import { NextRequest, NextResponse } from "next/server";
import { aiInvoke } from "@/lib/ai-invoke";
import type {
  SearchStrategy,
  SourceConfig,
  FilterRule,
} from "@/plugins/daily-briefing/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const description: string = (body.description ?? "").trim();

    if (!description) {
      return NextResponse.json(
        { error: "description is required" },
        { status: 400 },
      );
    }

    const strategy = await generateStrategyWithAI(description);
    return NextResponse.json({ strategy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---- AI-powered strategy generation ----

async function generateStrategyWithAI(
  description: string,
): Promise<SearchStrategy> {
  const prompt = buildStrategyPrompt(description);

  try {
    const result = await aiInvoke(prompt, { timeoutMs: 30000 });
    if (!result) return fallbackStrategy(description);

    // Extract JSON from response (may have markdown code blocks)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Strategy] No JSON found in AI response");
      return fallbackStrategy(description);
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return parseAIStrategy(parsed, description);
  } catch (err) {
    console.error("[Strategy] AI invocation error:", err);
    return fallbackStrategy(description);
  }
}

function buildStrategyPrompt(description: string): string {
  return `You are an AI assistant that generates search strategies for an information monitoring system.

Given this user's information need:
"${description}"

Generate a JSON search strategy with these fields:
{
  "keywords": ["keyword1", "keyword2", ...],
  "sources": [
    {
      "type": "web-search" | "github" | "arxiv" | "huggingface" | "rss" | "rsshub" | "youtube" | "finance" | "custom-api",
      "name": "descriptive name",
      "config": { ... source-specific config },
      "priority": 1-5
    }
  ],
  "filters": [],
  "relevancePrompt": "A prompt to evaluate item relevance",
  "schedule": "daily"
}

Source selection rules:
- For NEWS / current events / finance / stocks / politics / general topics: use "web-search" as PRIMARY source (priority 5)
- For academic / research / papers: use "arxiv" + "huggingface"
- For code / tools / frameworks: use "github"
- For tech blogs / industry: use "rss" with suggested feed URLs in config.url
- For Bilibili / 小红书 / Weibo / Douban / other social platforms: use "rsshub" with route in config.route (e.g., "/bilibili/hot/0/3", "/xiaohongshu/user/xxx/notes")
- For YouTube channels / playlists: use "youtube" with channelId or playlistId
- For finance / stocks / market news: use "finance" with symbols and optional finnhubToken
- For any REST API endpoint: use "custom-api" with url, itemsPath, and mapping
- ALWAYS include "web-search" unless the topic is PURELY academic
- For Chinese topics, generate Chinese keywords (5-10 keywords)
- For English topics, generate English keywords (5-10 keywords)
- Mix languages if the topic benefits from both

Source config formats:
- web-search: { "query": "the search query" }
- rss: { "url": "feed url" }
- rsshub: { "route": "/platform/path", "baseUrl": "https://rsshub.app" (optional) }
- youtube: { "channelId": "UCxxxx" } or { "playlistId": "PLxxxx" }
- finance: { "symbols": "AAPL,TSLA,NVDA", "finnhubToken": "optional_token" }
- custom-api: { "url": "https://api.example.com/data", "method": "GET", "headers": "{}", "itemsPath": "data.items", "mapping": "{\"title\":\"name\",\"url\":\"link\",\"description\":\"summary\",\"thumbnail\":\"image_url\",\"publishedAt\":\"created_at\"}" }
- github: { "sort": "stars", "per_page": "20" }
- arxiv: { "categories": "cs.AI,cs.CL" }
- huggingface: {}

Return ONLY valid JSON, no explanation, no markdown code fences.`;
}

function parseAIStrategy(
  parsed: Record<string, unknown>,
  description: string,
): SearchStrategy {
  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as string[]).filter(
        (k) => typeof k === "string" && k.trim(),
      )
    : [];

  const rawSources = Array.isArray(parsed.sources)
    ? (parsed.sources as Record<string, unknown>[])
    : [];

  const validTypes = new Set([
    "web-search",
    "github",
    "arxiv",
    "huggingface",
    "rss",
    "rsshub",
    "youtube",
    "finance",
    "custom-api",
  ]);

  const sources: SourceConfig[] = rawSources
    .filter((s) => typeof s.type === "string" && validTypes.has(s.type))
    .map((s) => ({
      type: s.type as SourceConfig["type"],
      name: typeof s.name === "string" ? s.name : "Search",
      config:
        typeof s.config === "object" && s.config !== null
          ? (s.config as Record<string, string>)
          : {},
      priority:
        typeof s.priority === "number"
          ? Math.max(1, Math.min(5, s.priority))
          : 3,
    }));

  const relevancePrompt =
    typeof parsed.relevancePrompt === "string"
      ? parsed.relevancePrompt
      : `Is this relevant to: "${description}"?`;

  const schedule =
    parsed.schedule === "manual" || parsed.schedule === "weekly"
      ? (parsed.schedule as "manual" | "weekly")
      : "daily";

  const filters: FilterRule[] = Array.isArray(parsed.filters)
    ? (parsed.filters as FilterRule[])
    : [];

  return { keywords, sources, filters, relevancePrompt, schedule };
}

// ---- Fallback heuristic (enhanced) ----

/**
 * Enhanced heuristic strategy generator.
 * Used when Claude CLI is unavailable.
 * Always includes web-search for non-purely-academic topics.
 */
function fallbackStrategy(description: string): SearchStrategy {
  const lower = description.toLowerCase();
  const isChinese = /[\u4e00-\u9fff]/.test(description);

  // Extract keywords — handle Chinese differently
  const keywords = isChinese
    ? extractChineseKeywords(description)
    : extractEnglishKeywords(description);

  const sources: SourceConfig[] = [];

  const hasAcademic =
    /paper|论文|arxiv|research|学术|academic|study/i.test(lower);
  const hasGitHub =
    /github|repo|repository|code|开源|open.?source|project|框架|framework|tool|library/i.test(
      lower,
    );
  const hasHF =
    /hugging.?face|model|模型|diffusion|transformer|llm|vlm|bert|gpt/i.test(
      lower,
    );
  const hasML =
    /machine.?learning|deep.?learning|ai|ml|dl|neural|训练|模型|agent|rl/i.test(
      lower,
    );
  const hasFinance =
    /stock|stocks|finance|financi|market|invest|trading|etf|crypto|bitcoin|股票|金融|基金|投资|行情|美股|a股|港股/i.test(
      lower,
    );
  const hasYouTube =
    /youtube|视频|channel|频道|youtuber/i.test(lower);
  const hasRSSHub =
    /bilibili|b站|小红书|douban|豆瓣|weibo|微博|zhihu|知乎|xiaohongshu/i.test(
      lower,
    );

  // Always add web-search as primary unless purely academic
  const isPurelyAcademic = hasAcademic && !hasGitHub && !hasHF;
  if (!isPurelyAcademic) {
    sources.push({
      type: "web-search",
      name: "Web Search",
      config: { query: description },
      priority: 5,
    });
  }

  if (hasGitHub || hasML) {
    sources.push({
      type: "github",
      name: "GitHub Repositories",
      config: { sort: "stars", order: "desc", per_page: "20" },
      priority: hasGitHub ? 5 : 3,
    });
  }

  if (hasAcademic || hasML) {
    const categories: string[] = [];
    if (/vision|cv|image|视觉|vlm|clip/i.test(lower)) categories.push("cs.CV");
    if (/language|nlp|llm|text|文本|gpt/i.test(lower))
      categories.push("cs.CL");
    if (/machine.?learning|ml|学习/i.test(lower)) categories.push("cs.LG");
    if (/ai|artificial|智能|agent/i.test(lower)) categories.push("cs.AI");
    if (/robot|机器人/i.test(lower)) categories.push("cs.RO");
    if (categories.length === 0) categories.push("cs.AI", "cs.LG");

    sources.push({
      type: "arxiv",
      name: "ArXiv Papers",
      config: { categories: categories.join(",") },
      priority: hasAcademic ? 5 : 3,
    });
  }

  if (hasHF || hasML) {
    sources.push({
      type: "huggingface",
      name: "HuggingFace Daily Papers",
      config: {},
      priority: hasHF ? 5 : 2,
    });
  }

  if (hasFinance) {
    sources.push({
      type: "finance",
      name: "Finance News",
      config: {},
      priority: 5,
    });
  }

  if (hasYouTube) {
    sources.push({
      type: "web-search",
      name: "YouTube Search",
      config: { query: `${description} site:youtube.com` },
      priority: 3,
    });
  }

  if (hasRSSHub) {
    // Detect platform and suggest route
    let route = "/bilibili/hot/0/3";
    if (/小红书|xiaohongshu/i.test(lower)) route = "/xiaohongshu/explore";
    else if (/豆瓣|douban/i.test(lower)) route = "/douban/explore";
    else if (/微博|weibo/i.test(lower)) route = "/weibo/search/hot";
    else if (/知乎|zhihu/i.test(lower)) route = "/zhihu/hot";

    sources.push({
      type: "rsshub",
      name: "RSSHub",
      config: { route },
      priority: 4,
    });
  }

  // Default: if no specific sources detected, add web-search + GitHub
  if (sources.length === 0) {
    sources.push({
      type: "web-search",
      name: "Web Search",
      config: { query: description },
      priority: 5,
    });
    sources.push({
      type: "github",
      name: "GitHub Repositories",
      config: { sort: "stars", order: "desc", per_page: "20" },
      priority: 2,
    });
  }

  const relevancePrompt = `Evaluate if the following item is relevant to: "${description}". Consider title, description, and keywords. Return a score from 0 to 1.`;

  return {
    keywords,
    sources,
    filters: [],
    relevancePrompt,
    schedule: "daily",
  };
}

/**
 * Extract keywords from Chinese text.
 * Chinese text doesn't split on spaces — extract meaningful phrases/segments.
 */
function extractChineseKeywords(description: string): string[] {
  const keywords: string[] = [];

  // Chinese stop words
  const stopWords = new Set([
    "我",
    "想",
    "要",
    "的",
    "了",
    "在",
    "和",
    "是",
    "有",
    "最新",
    "每天",
    "帮",
    "看",
    "看看",
    "跟踪",
    "关注",
    "关心",
    "能",
    "请",
    "给",
    "一些",
    "什么",
    "哪些",
    "这些",
    "那些",
    "可以",
    "如何",
    "怎么",
    "为什么",
    "需要",
    "相关",
    "所有",
    "一下",
    "告诉",
  ]);

  // Extract English words embedded in Chinese text
  const englishWords = description.match(/[a-zA-Z][a-zA-Z0-9./-]+/g) ?? [];
  for (const w of englishWords) {
    if (w.length > 1) keywords.push(w);
  }

  // Extract Chinese segments (2-6 character phrases between stop words / punctuation)
  const cleaned = description
    .replace(/[a-zA-Z0-9./-]+/g, " ")
    .replace(/[^\u4e00-\u9fff\s]/g, " ");

  const segments = cleaned.split(/\s+/).filter(Boolean);
  for (const seg of segments) {
    // Remove stop words from segment
    let remaining = seg;
    for (const sw of stopWords) {
      remaining = remaining.replace(new RegExp(sw, "g"), "|");
    }
    const parts = remaining.split("|").filter((p) => p.length >= 2);
    keywords.push(...parts);
  }

  // Also add the full description as a search phrase (trimmed)
  const fullQuery = description.replace(/[我想要帮看给请的了]+/g, "").trim();
  if (fullQuery.length >= 2 && fullQuery.length <= 30) {
    keywords.unshift(fullQuery);
  }

  return [...new Set(keywords)].slice(0, 10);
}

function extractEnglishKeywords(description: string): string[] {
  const stopWords = new Set([
    "i",
    "me",
    "my",
    "want",
    "to",
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "can",
    "and",
    "or",
    "but",
    "if",
    "in",
    "on",
    "at",
    "by",
    "for",
    "with",
    "about",
    "of",
    "from",
    "up",
    "out",
    "that",
    "this",
    "it",
    "its",
    "not",
    "no",
    "so",
    "as",
    "just",
    "also",
    "than",
    "then",
    "when",
    "what",
    "which",
    "who",
    "how",
    "all",
    "each",
    "every",
    "any",
    "some",
    "such",
    "very",
    "too",
    "most",
    "more",
    "much",
    "many",
    "new",
    "latest",
    "recent",
    "track",
    "follow",
    "watch",
    "monitor",
    "keep",
    "find",
    "look",
    "see",
    "check",
    "get",
    "help",
  ]);

  const words = description
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));

  return [...new Set(words)].slice(0, 10);
}
