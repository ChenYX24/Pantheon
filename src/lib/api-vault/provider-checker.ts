/**
 * Provider Checker - Unified API health & balance checking for multiple AI platforms.
 * Supports custom base URLs (OpenAI-compatible proxies) with automatic auth detection.
 */

import { EnvHttpProxyAgent } from "undici";

// ---- Proxy-aware fetch ----
// Node.js native fetch ignores HTTP_PROXY/HTTPS_PROXY env vars.
// Use undici's EnvHttpProxyAgent to route through system proxy when configured.

let _proxyDispatcher: EnvHttpProxyAgent | undefined;
function getProxyDispatcher(): EnvHttpProxyAgent {
  if (!_proxyDispatcher) {
    _proxyDispatcher = new EnvHttpProxyAgent();
  }
  return _proxyDispatcher;
}

function hasProxyEnv(): boolean {
  return !!(
    process.env.HTTP_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.https_proxy
  );
}

/** Fetch with automatic proxy support when HTTP(S)_PROXY env vars are set */
function proxyFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  if (hasProxyEnv()) {
    return fetch(url, { ...init, dispatcher: getProxyDispatcher() } as RequestInit);
  }
  return fetch(url, init);
}

// ---- Types ----

export interface ProviderCheckResult {
  valid: boolean;
  balance: { amount: number; currency: string } | null;
  models: ModelInfo[];
  usage: { used: number; limit: number } | null;
  rateLimit: { remaining: number; limit: number; resetAt: string } | null;
  error?: string;
  checkedAt: string;
}

export interface ModelInfo {
  id: string;
  ownedBy?: string;
  created?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  authType: "bearer" | "x-api-key" | "query-param";
  modelsEndpoint: string;
  balanceEndpoint: string | null;
  balanceParser: ((data: unknown) => { amount: number; currency: string } | null) | null;
  usageEndpoints?: { subscription: string; usage: string };
  modelsParser: (data: unknown) => ModelInfo[];
}

// ---- Standard OpenAI-style model parser ----

function parseOpenAIModels(data: unknown): ModelInfo[] {
  const d = data as { data?: { id: string; owned_by?: string; created?: number }[] };
  return (
    d.data?.map((m) => ({
      id: m.id,
      ownedBy: m.owned_by,
      created: m.created,
    })) ?? []
  );
}

// ---- Provider Configurations ----

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    authType: "x-api-key",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: parseOpenAIModels,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    usageEndpoints: {
      subscription: "/v1/dashboard/billing/subscription",
      usage: "/v1/dashboard/billing/usage",
    },
    modelsParser: parseOpenAIModels,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: "/user/balance",
    balanceParser: (data) => {
      const d = data as { balance_infos?: { total_balance: string; currency: string }[] };
      if (d.balance_infos?.[0]) {
        return {
          amount: parseFloat(d.balance_infos[0].total_balance),
          currency: d.balance_infos[0].currency || "CNY",
        };
      }
      return null;
    },
    modelsParser: parseOpenAIModels,
  },
  siliconflow: {
    id: "siliconflow",
    name: "SiliconFlow",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: "/v1/user/info",
    balanceParser: (data) => {
      const d = data as { data?: { balance: string; totalBalance?: string } };
      if (d.data?.balance !== undefined) {
        return { amount: parseFloat(d.data.balance), currency: "CNY" };
      }
      return null;
    },
    modelsParser: parseOpenAIModels,
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: "/v1/users/me/balance",
    balanceParser: (data) => {
      const d = data as { data?: { available_balance?: number; balance?: number } };
      const bal = d.data?.available_balance ?? d.data?.balance;
      if (bal !== undefined) {
        return { amount: bal, currency: "CNY" };
      }
      return null;
    },
    modelsParser: parseOpenAIModels,
  },
  zhipu: {
    id: "zhipu",
    name: "Zhipu AI",
    authType: "bearer",
    modelsEndpoint: "/api/paas/v4/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: parseOpenAIModels,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    authType: "bearer",
    modelsEndpoint: "/api/v1/models",
    balanceEndpoint: "/api/v1/auth/key",
    balanceParser: (data) => {
      const d = data as { data?: { limit?: number; usage?: number; limit_remaining?: number } };
      if (d.data?.limit_remaining !== undefined) {
        return { amount: d.data.limit_remaining, currency: "USD" };
      }
      if (d.data?.limit !== undefined && d.data?.usage !== undefined) {
        return { amount: d.data.limit - d.data.usage, currency: "USD" };
      }
      return null;
    },
    modelsParser: parseOpenAIModels,
  },
  groq: {
    id: "groq",
    name: "Groq",
    authType: "bearer",
    modelsEndpoint: "/openai/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: parseOpenAIModels,
  },
  together: {
    id: "together",
    name: "Together AI",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: (data) => {
      const d = data as { id: string; owned_by?: string }[] | { data?: { id: string; owned_by?: string }[] };
      if (Array.isArray(d)) return d.map((m) => ({ id: m.id, ownedBy: m.owned_by }));
      return parseOpenAIModels(d);
    },
  },
  google: {
    id: "google",
    name: "Google AI",
    authType: "query-param",
    modelsEndpoint: "/v1beta/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: (data) => {
      const d = data as { models?: { name: string }[] };
      return d.models?.map((m) => ({ id: m.name.replace("models/", "") })) ?? [];
    },
  },
  mistral: {
    id: "mistral",
    name: "Mistral",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: parseOpenAIModels,
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    authType: "bearer",
    modelsEndpoint: "/v2/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: (data) => {
      const d = data as { models?: { name: string }[] };
      return d.models?.map((m) => ({ id: m.name })) ?? [];
    },
  },
  volcengine: {
    id: "volcengine",
    name: "Volcengine",
    authType: "bearer",
    modelsEndpoint: "/v3/models",
    balanceEndpoint: null,
    balanceParser: null,
    modelsParser: parseOpenAIModels,
  },
  custom: {
    id: "custom",
    name: "Custom",
    authType: "bearer",
    modelsEndpoint: "/v1/models",
    balanceEndpoint: null,
    balanceParser: null,
    usageEndpoints: {
      subscription: "/v1/dashboard/billing/subscription",
      usage: "/v1/dashboard/billing/usage",
    },
    modelsParser: parseOpenAIModels,
  },
};

// ---- Default Base URLs ----

const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  siliconflow: "https://api.siliconflow.cn",
  moonshot: "https://api.moonshot.cn",
  zhipu: "https://open.bigmodel.cn",
  openrouter: "https://openrouter.ai",
  groq: "https://api.groq.com",
  together: "https://api.together.xyz",
  google: "https://generativelanguage.googleapis.com",
  mistral: "https://api.mistral.ai",
  cohere: "https://api.cohere.com",
  volcengine: "https://ark.cn-beijing.volces.com/api",
  baidu: "https://aip.baidubce.com",
  custom: "",
};

export function getDefaultBaseUrl(providerId: string): string {
  return DEFAULT_BASE_URLS[providerId] ?? "";
}

export function getProviderConfig(providerId: string): ProviderConfig {
  return PROVIDER_CONFIGS[providerId] ?? PROVIDER_CONFIGS.custom;
}

// ---- Detect if using a custom proxy ----

function isCustomProxy(providerId: string, baseUrl: string): boolean {
  const defaultUrl = DEFAULT_BASE_URLS[providerId];
  if (!defaultUrl) return true;
  try {
    const defaultHost = new URL(defaultUrl).hostname;
    const actualHost = new URL(baseUrl).hostname;
    return defaultHost !== actualHost;
  } catch {
    return true;
  }
}

// ---- Auth header builder ----

/** Strip non-ASCII from API key to prevent ByteString errors in HTTP headers */
function ensureAsciiKey(apiKey: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = apiKey.replace(/[^\x20-\x7E]/g, "").trim();
  if (!cleaned) throw new Error("API key is empty or contains only invalid characters");
  return cleaned;
}

function buildHeaders(
  config: ProviderConfig,
  apiKey: string,
  forceBearer: boolean = false,
): Record<string, string> {
  const safeKey = ensureAsciiKey(apiKey);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (forceBearer || config.authType === "bearer") {
    headers["Authorization"] = `Bearer ${safeKey}`;
  } else if (config.authType === "x-api-key") {
    headers["x-api-key"] = safeKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  // query-param handled in URL
  return headers;
}

function buildUrl(
  baseUrl: string,
  path: string,
  config: ProviderConfig,
  apiKey: string,
  forceBearer: boolean = false,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  let fullUrl: string;
  if (path.startsWith("/") && base.endsWith(path.split("/").slice(0, 2).join("/"))) {
    const subPath = "/" + path.split("/").slice(2).join("/");
    fullUrl = base + subPath;
  } else {
    fullUrl = base + path;
  }
  const url = new URL(fullUrl);
  if (!forceBearer && config.authType === "query-param") {
    url.searchParams.set("key", ensureAsciiKey(apiKey));
  }
  return url.toString();
}

// ---- Fetchers ----

async function fetchModels(
  baseUrl: string,
  config: ProviderConfig,
  apiKey: string,
  forceBearer: boolean,
): Promise<{ valid: boolean; models: ModelInfo[]; error?: string }> {
  const headers = buildHeaders(config, apiKey, forceBearer);
  const endpoints = [config.modelsEndpoint];
  // For custom/proxy providers, try common OpenAI-compatible paths
  if (config.id === "custom" || forceBearer) {
    if (!endpoints.includes("/v1/models")) endpoints.push("/v1/models");
    if (!endpoints.includes("/models")) endpoints.push("/models");
  }

  let lastError = "";
  for (const endpoint of endpoints) {
    try {
      const url = buildUrl(baseUrl, endpoint, config, apiKey, forceBearer);
      const res = await proxyFetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 403) {
        return { valid: false, models: [], error: "Invalid API key" };
      }
      if (res.status === 429) {
        return { valid: true, models: [], error: "Rate limited" };
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      const models = parseOpenAIModels(data);
      if (models.length > 0) return { valid: true, models };
      // Fallback to config parser
      const configModels = config.modelsParser(data);
      return { valid: true, models: configModels };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Connection failed";
    }
  }
  return { valid: false, models: [], error: lastError };
}

async function fetchBalance(
  baseUrl: string,
  config: ProviderConfig,
  apiKey: string,
  forceBearer: boolean,
): Promise<{ amount: number; currency: string } | null> {
  if (!config.balanceEndpoint || !config.balanceParser) return null;
  try {
    const url = buildUrl(baseUrl, config.balanceEndpoint, config, apiKey, forceBearer);
    const res = await proxyFetch(url, {
      headers: buildHeaders(config, apiKey, forceBearer),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return config.balanceParser(data);
  } catch {
    return null;
  }
}

/**
 * Fetch balance via OpenAI billing endpoints (subscription + usage).
 * Works with OpenAI and OpenAI-compatible proxies (e.g., anyrouter.top).
 */
async function fetchOpenAIBilling(
  baseUrl: string,
  config: ProviderConfig,
  apiKey: string,
  forceBearer: boolean,
): Promise<{ balance: { amount: number; currency: string } | null; usage: { used: number; limit: number } | null }> {
  const endpoints = config.usageEndpoints;
  if (!endpoints) return { balance: null, usage: null };

  const headers = buildHeaders(config, apiKey, forceBearer);

  try {
    const [subRes, usageRes] = await Promise.all([
      proxyFetch(buildUrl(baseUrl, endpoints.subscription, config, apiKey, forceBearer), {
        headers,
        signal: AbortSignal.timeout(10000),
      }).catch(() => null),
      proxyFetch(buildUrl(baseUrl, endpoints.usage, config, apiKey, forceBearer), {
        headers,
        signal: AbortSignal.timeout(10000),
      }).catch(() => null),
    ]);

    let limit = 0;
    let used = 0;

    if (subRes?.ok) {
      const subData = (await subRes.json()) as {
        hard_limit_usd?: number;
        system_hard_limit_usd?: number;
      };
      limit = subData.hard_limit_usd ?? subData.system_hard_limit_usd ?? 0;
    }

    if (usageRes?.ok) {
      const usageData = (await usageRes.json()) as { total_usage?: number };
      // total_usage is in cents
      used = (usageData.total_usage ?? 0) / 100;
    }

    const remaining = limit - used;
    return {
      balance: limit > 0 ? { amount: remaining, currency: "USD" } : null,
      usage: { used, limit },
    };
  } catch {
    return { balance: null, usage: null };
  }
}

// ---- Public API ----

export async function checkProvider(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ProviderCheckResult> {
  const config = getProviderConfig(providerId);
  const resolvedBaseUrl = (baseUrl?.trim() || getDefaultBaseUrl(providerId)).replace(/\/+$/, "");

  if (!resolvedBaseUrl) {
    return {
      valid: false,
      balance: null,
      models: [],
      usage: null,
      rateLimit: null,
      error: "No base URL configured",
      checkedAt: new Date().toISOString(),
    };
  }

  // If using a custom proxy (base URL differs from provider default),
  // force Bearer auth since most proxies are OpenAI-compatible
  const forceBearer = isCustomProxy(providerId, resolvedBaseUrl);

  // Determine which balance strategy to use
  const useOpenAIBilling =
    forceBearer || config.usageEndpoints != null;

  // Fetch models and balance in parallel
  const [modelsResult, balanceResult, billingResult] = await Promise.all([
    fetchModels(resolvedBaseUrl, config, apiKey, forceBearer),
    useOpenAIBilling ? Promise.resolve(null) : fetchBalance(resolvedBaseUrl, config, apiKey, forceBearer),
    useOpenAIBilling ? fetchOpenAIBilling(resolvedBaseUrl, config, apiKey, forceBearer) : Promise.resolve(null),
  ]);

  // Merge balance from either source
  const balance = billingResult?.balance ?? balanceResult ?? null;
  const usage = billingResult?.usage ?? null;

  return {
    valid: modelsResult.valid,
    balance,
    models: modelsResult.models,
    usage,
    rateLimit: null,
    error: modelsResult.error,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Quick validate a key - just checks if the key is valid without fetching the full models list.
 */
export async function validateKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const config = getProviderConfig(providerId);
  const resolvedBaseUrl = (baseUrl?.trim() || getDefaultBaseUrl(providerId)).replace(/\/+$/, "");
  if (!resolvedBaseUrl) return { valid: false, error: "No base URL" };

  const forceBearer = isCustomProxy(providerId, resolvedBaseUrl);

  try {
    const url = buildUrl(resolvedBaseUrl, config.modelsEndpoint, config, apiKey, forceBearer);
    const res = await proxyFetch(url, {
      headers: buildHeaders(config, apiKey, forceBearer),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) return { valid: false, error: "Invalid key" };
    if (res.status === 429) return { valid: true }; // rate limited but valid
    if (res.ok) return { valid: true };
    return { valid: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
