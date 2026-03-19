/**
 * Daily Briefing Plugin - Type Definitions (v2)
 *
 * AI-driven personalized information radar.
 * User defines what they care about -> AI generates search strategy -> fetch & filter.
 */

// ---- Info Need ----

/** A user-defined information need / tracking interest */
export interface InfoNeed {
  id: string;
  name: string;
  description: string;        // user's original natural language input
  strategy: SearchStrategy;
  tags: string[];
  enabled: boolean;
  createdAt: string;
  lastFetchedAt?: string;
}

/** AI-generated search strategy for an InfoNeed */
export interface SearchStrategy {
  keywords: string[];
  sources: SourceConfig[];
  filters: FilterRule[];
  relevancePrompt: string;    // AI prompt for judging relevance
  schedule: "manual" | "daily" | "weekly";
}

/** Data source configuration (extensible to any source) */
export interface SourceConfig {
  type: SourceType;
  name: string;
  config: Record<string, string>;
  priority: number;           // 1-5
}

export type SourceType =
  | "github"
  | "arxiv"
  | "huggingface"
  | "rss"
  | "rsshub"
  | "youtube"
  | "finance"
  | "web-search"
  | "custom-api";

/** Filter rule for post-fetch filtering */
export interface FilterRule {
  field: string;
  operator: "contains" | "not-contains" | "regex" | "date-after";
  value: string;
}

// ---- Briefing Items ----

/** A single briefing item (paper, repo, article, etc.) */
export interface BriefingItem {
  id: string;
  needId: string;
  source: string;
  sourceType: SourceType;
  title: string;
  url: string;
  description: string;
  author?: string;
  publishedAt: string;
  tags: string[];
  relevanceScore: number;     // 0-1
  userFeedback?: "good" | "bad" | "star";
  isRead: boolean;
  isFavorite: boolean;
  stars?: number;             // GitHub stars
  language?: string;          // GitHub language
  thumbnail?: string;         // Image URL for visual preview
  demoUrl?: string;           // Demo/space/project page URL
  githubUrl?: string;         // GitHub repo URL
  upvotes?: number;           // Community upvotes (HF)
  aiKeywords?: string[];      // AI-generated keywords
}

/** A day's briefing aggregate */
export interface DailyBriefing {
  date: string;               // YYYY-MM-DD
  items: BriefingItem[];
  summary?: string;           // AI-generated global summary
  summaries?: Record<string, string>;  // Per-need AI summaries (keyed by needId)
  summaryLanguage?: "zh" | "en";  // Language of the generated summary
  summaryGeneratedAt?: string;     // When the summary was generated
  stats: BriefingStats;
}

/** User configuration for briefing behavior */
export interface BriefingUserConfig {
  summaryLanguage: "zh" | "en";  // Preferred summary language
  sources?: Record<string, boolean>;
  github?: { language: string; timeRange: string };
  arxiv?: { categories: string[] };
  rssFeeds?: { name: string; url: string }[];
  display?: { maxItemsPerSource: number; autoRefreshInterval: string };
}

export interface BriefingStats {
  total: number;
  byNeed: Record<string, number>;
  bySource: Record<string, number>;
}

// ---- API request/response types ----

export interface CreateNeedRequest {
  name: string;
  description: string;
  tags: string[];
  strategy?: SearchStrategy;
}

export interface UpdateNeedRequest {
  id: string;
  name?: string;
  description?: string;
  tags?: string[];
  strategy?: SearchStrategy;
  enabled?: boolean;
}

export interface FetchRequest {
  needId?: string;            // optional: fetch specific need or all
}

export interface FeedbackRequest {
  itemId: string;
  date: string;
  feedback: "good" | "bad" | "star";
}

export interface StrategyRequest {
  description: string;
}

// ---- Push Notifications ----

export interface PushConfig {
  enabled: boolean;
  channels: PushChannel[];
  format: "summary-only" | "summary-and-items" | "items-only";
  maxItems: number;
  includeLinks: boolean;
}

export interface PushChannel {
  platform: "telegram" | "feishu";
  chatId: string;
  enabled: boolean;
  label?: string;
}

export interface PushResult {
  platform: string;
  chatId: string;
  success: boolean;
  error?: string;
}
