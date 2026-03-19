/**
 * API Key Store - Encrypted storage for API keys in SQLite.
 *
 * Keys are obfuscated using a simple XOR-based encoding with a machine-specific
 * seed (hostname + homedir). This is NOT cryptographically secure encryption --
 * it prevents casual exposure in plaintext but does not protect against a
 * determined attacker with database access. For production use, integrate with
 * OS keychain or a secrets manager.
 */

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import crypto from "crypto";
import { ensureDataMigration } from "@/lib/migrate-data";

// ---- Types ----

export interface ApiKeyRecord {
  id: string;
  provider: string;
  name: string;
  key_masked: string;
  base_url: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  usage_count: number;
  monthly_budget: number | null;
  notes: string;
}

export interface ApiKeyInput {
  provider: string;
  name: string;
  key: string;
  base_url?: string;
  monthly_budget?: number | null;
  notes?: string;
}

// ---- Known providers ----

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", prefix: "sk-ant-", defaultBaseUrl: "https://api.anthropic.com" },
  { id: "openai", name: "OpenAI", prefix: "sk-", defaultBaseUrl: "https://api.openai.com" },
  { id: "deepseek", name: "DeepSeek", prefix: "sk-", defaultBaseUrl: "https://api.deepseek.com" },
  { id: "siliconflow", name: "SiliconFlow", prefix: "sk-", defaultBaseUrl: "https://api.siliconflow.cn" },
  { id: "moonshot", name: "Moonshot", prefix: "sk-", defaultBaseUrl: "https://api.moonshot.cn" },
  { id: "zhipu", name: "Zhipu AI", prefix: "", defaultBaseUrl: "https://open.bigmodel.cn" },
  { id: "openrouter", name: "OpenRouter", prefix: "sk-or-", defaultBaseUrl: "https://openrouter.ai/api" },
  { id: "groq", name: "Groq", prefix: "gsk_", defaultBaseUrl: "https://api.groq.com/openai" },
  { id: "together", name: "Together AI", prefix: "", defaultBaseUrl: "https://api.together.xyz" },
  { id: "google", name: "Google AI", prefix: "AI", defaultBaseUrl: "https://generativelanguage.googleapis.com" },
  { id: "mistral", name: "Mistral", prefix: "", defaultBaseUrl: "https://api.mistral.ai" },
  { id: "cohere", name: "Cohere", prefix: "", defaultBaseUrl: "https://api.cohere.com" },
  { id: "volcengine", name: "Volcengine (火山引擎)", prefix: "", defaultBaseUrl: "https://ark.cn-beijing.volces.com/api" },
  { id: "baidu", name: "Baidu (百度千帆)", prefix: "", defaultBaseUrl: "https://aip.baidubce.com" },
  { id: "custom", name: "Custom / OpenAI Compatible", prefix: "", defaultBaseUrl: "" },
] as const;

// ---- Obfuscation ----

/**
 * Derive encryption key from machine-specific seed.
 * Uses only homedir (stable) — hostname can change across reboots/renames.
 */
function deriveKey(): Buffer {
  const seed = `ptn-vault-v2:${os.homedir()}`;
  return crypto.createHash("sha256").update(seed).digest();
}

/** Legacy key derivation (v1: included hostname) — used for migration only */
function deriveKeyV1(): Buffer {
  const seed = `ptn-vault:${os.hostname()}:${os.homedir()}`;
  return crypto.createHash("sha256").update(seed).digest();
}

function obfuscate(plaintext: string): string {
  const key = deriveKey();
  const buf = Buffer.from(plaintext, "utf-8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  return out.toString("base64");
}

function deobfuscate(encoded: string): string {
  const key = deriveKey();
  const buf = Buffer.from(encoded, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[i % key.length];
  }
  const result = out.toString("utf-8");
  // Detect corrupted decryption (U+FFFD replacement characters indicate
  // the key was encrypted with a different machine seed)
  if (result.includes("\uFFFD")) {
    throw new Error(
      "API key decryption failed — the key may have been stored on a different machine or the hostname changed. Please re-enter the key."
    );
  }
  return result;
}

/** Validate that a string is safe for use in HTTP headers (Latin-1 / ByteString compatible) */
export function sanitizeApiKey(key: string): string {
  // Strip any non-ASCII characters (control chars, Unicode, BOM, etc.)
  const cleaned = key.replace(/[^\x20-\x7E]/g, "").trim();
  if (cleaned.length < 4) {
    throw new Error(
      "API key contains invalid characters. Please re-enter the key — avoid copying from PDFs or formatted text."
    );
  }
  return cleaned;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

// ---- Database ----

ensureDataMigration();
const DB_PATH = path.join(os.homedir(), ".claude", "ptn-dashboard.db");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _global = globalThis as any;
const DB_SYMBOL = Symbol.for("ptn-api-vault-db");
const DB_VERSION_KEY = Symbol.for("ptn-api-vault-db-version");
const CURRENT_DB_VERSION = 2;

function getStoredDb(): Database.Database | null { return _global[DB_SYMBOL] ?? null; }
function setStoredDb(db: Database.Database) { _global[DB_SYMBOL] = db; }
function getStoredVersion(): number { return _global[DB_VERSION_KEY] ?? 0; }
function setStoredVersion(v: number) { _global[DB_VERSION_KEY] = v; }

let _db: Database.Database | null = getStoredDb();
let _dbVersion = getStoredVersion();

function getDb(): Database.Database {
  if (!_db || _dbVersion < CURRENT_DB_VERSION) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL");
    _db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        key_encrypted TEXT NOT NULL,
        key_masked TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        last_used_at TEXT,
        usage_count INTEGER DEFAULT 0,
        monthly_budget REAL,
        notes TEXT DEFAULT '',
        base_url TEXT DEFAULT '',
        is_active INTEGER DEFAULT 1
      )
    `);

    // Migration: add new columns if they don't exist (for existing databases)
    try { _db.exec("ALTER TABLE api_keys ADD COLUMN base_url TEXT DEFAULT ''"); } catch {}
    try { _db.exec("ALTER TABLE api_keys ADD COLUMN is_active INTEGER DEFAULT 1"); } catch {}

    // Usage snapshots table — records balance at each check for historical tracking
    _db.exec(`
      CREATE TABLE IF NOT EXISTS usage_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_id TEXT NOT NULL,
        balance REAL,
        used REAL,
        currency TEXT DEFAULT 'USD',
        checked_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
      )
    `);
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_key_date ON usage_snapshots(key_id, checked_at)`);

    _dbVersion = CURRENT_DB_VERSION;
    setStoredDb(_db);
    setStoredVersion(_dbVersion);
  }
  return _db;
}

// ---- CRUD ----

export function listKeys(): ApiKeyRecord[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, provider, name, key_masked, base_url, is_active,
            created_at, updated_at, last_used_at, usage_count, monthly_budget, notes
     FROM api_keys ORDER BY created_at DESC`
  ).all();
  return rows as ApiKeyRecord[];
}

export function getKey(id: string): ApiKeyRecord | undefined {
  const db = getDb();
  return db.prepare(
    `SELECT id, provider, name, key_masked, base_url, is_active,
            created_at, updated_at, last_used_at, usage_count, monthly_budget, notes
     FROM api_keys WHERE id = ?`
  ).get(id) as ApiKeyRecord | undefined;
}

export function getDecryptedKey(id: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT key_encrypted FROM api_keys WHERE id = ?").get(id) as
    | { key_encrypted: string }
    | undefined;
  if (!row) return null;
  return deobfuscate(row.key_encrypted);
}

export function addKey(input: ApiKeyInput): ApiKeyRecord {
  const db = getDb();
  const id = crypto.randomUUID();
  const cleanKey = sanitizeApiKey(input.key);
  const encrypted = obfuscate(cleanKey);
  const masked = maskKey(cleanKey);

  db.prepare(
    `INSERT INTO api_keys (id, provider, name, key_encrypted, key_masked, base_url, monthly_budget, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.provider,
    input.name,
    encrypted,
    masked,
    input.base_url ?? "",
    input.monthly_budget ?? null,
    input.notes ?? ""
  );

  return getKey(id)!;
}

export function updateKey(
  id: string,
  updates: {
    name?: string;
    key?: string;
    base_url?: string;
    is_active?: number;
    monthly_budget?: number | null;
    notes?: string;
  }
): ApiKeyRecord | null {
  const db = getDb();
  const existing = getKey(id);
  if (!existing) return null;

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    params.push(updates.name);
  }
  if (updates.key !== undefined) {
    sets.push("key_encrypted = ?", "key_masked = ?");
    params.push(obfuscate(updates.key), maskKey(updates.key));
  }
  if (updates.base_url !== undefined) {
    sets.push("base_url = ?");
    params.push(updates.base_url);
  }
  if (updates.is_active !== undefined) {
    sets.push("is_active = ?");
    params.push(updates.is_active);
  }
  if (updates.monthly_budget !== undefined) {
    sets.push("monthly_budget = ?");
    params.push(updates.monthly_budget);
  }
  if (updates.notes !== undefined) {
    sets.push("notes = ?");
    params.push(updates.notes);
  }

  params.push(id);
  db.prepare(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return getKey(id)!;
}

export function toggleKeyActive(id: string, active: boolean): ApiKeyRecord | null {
  return updateKey(id, { is_active: active ? 1 : 0 });
}

export function deleteKey(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM api_keys WHERE id = ?").run(id);
  return result.changes > 0;
}

export function recordKeyUsage(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE api_keys SET usage_count = usage_count + 1, last_used_at = datetime('now') WHERE id = ?`
  ).run(id);
}

// ---- Usage Snapshots ----

export interface UsageSnapshot {
  id: number;
  key_id: string;
  balance: number | null;
  used: number | null;
  currency: string;
  checked_at: string;
}

/** Record a balance/usage snapshot for a key */
export function addSnapshot(keyId: string, balance: number | null, used: number | null, currency: string = "USD"): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO usage_snapshots (key_id, balance, used, currency) VALUES (?, ?, ?, ?)`
  ).run(keyId, balance, used, currency);
}

/** Get snapshots for a key within a date range */
export function getSnapshots(keyId: string, days: number = 30): UsageSnapshot[] {
  const db = getDb();
  return db.prepare(
    `SELECT id, key_id, balance, used, currency, checked_at
     FROM usage_snapshots
     WHERE key_id = ? AND checked_at >= datetime('now', ?)
     ORDER BY checked_at ASC`
  ).all(keyId, `-${days} days`) as UsageSnapshot[];
}

/** Get daily aggregated snapshots (one per day, latest balance of each day) */
export function getDailySnapshots(keyId: string, days: number = 30): { date: string; balance: number | null; used: number | null; currency: string }[] {
  const db = getDb();
  // Use a window function approach: for each day, pick the row with the latest checked_at
  return db.prepare(
    `SELECT date(checked_at) as date, balance, used, currency
     FROM usage_snapshots
     WHERE key_id = ? AND checked_at >= datetime('now', ?)
     GROUP BY date(checked_at)
     HAVING checked_at = MAX(checked_at)
     ORDER BY date(checked_at) ASC`
  ).all(keyId, `-${days} days`) as { date: string; balance: number | null; used: number | null; currency: string }[];
}

/** Get daily aggregated snapshots across all keys */
export function getAllKeysDailySnapshots(days: number = 30): { date: string; total_balance: number; total_used: number }[] {
  const db = getDb();
  // For each key+day, pick the latest snapshot, then aggregate across keys per day
  return db.prepare(
    `SELECT day as date, SUM(balance) as total_balance, SUM(used) as total_used
     FROM (
       SELECT key_id, date(checked_at) as day, balance, used
       FROM usage_snapshots
       WHERE checked_at >= datetime('now', ?)
       GROUP BY key_id, date(checked_at)
       HAVING checked_at = MAX(checked_at)
     )
     GROUP BY day
     ORDER BY day ASC`
  ).all(`-${days} days`) as { date: string; total_balance: number; total_used: number }[];
}

/** Clean up old snapshots (keep last N days) */
export function cleanOldSnapshots(keepDays: number = 90): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM usage_snapshots WHERE checked_at < datetime('now', ?)`
  ).run(`-${keepDays} days`);
}

export function autoDetectProvider(key: string): string {
  for (const p of PROVIDERS) {
    if (p.prefix && key.startsWith(p.prefix)) return p.id;
  }
  return "custom";
}
