// v2 runtime configuration (no persistence/report-delivery knobs; shadows are
// ephemeral subagents and reports arrive as completion notifications).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { configPath } from "./paths.mjs";
import { normalizeExts } from "./trigger.mjs";

/** Mainstream language/script extensions for auto_review_exts. */
export const MAINSTREAM_EXTS = [
  "py", "ts", "tsx", "js", "jsx", "mjs", "cjs", "java", "kt", "kts", "go", "rs",
  "c", "h", "cc", "cpp", "hpp", "cs", "sh", "zsh", "bash", "ps1", "rb", "php",
  "swift", "scala", "sql", "dart", "lua", "pl", "r", "groovy", "ex", "exs",
  "erl", "clj", "cljs", "fs", "nim", "zig", "hs", "ml", "vue", "svelte",
  "html", "htm", "css", "scss", "proto", "prisma",
];

export const DEFAULT_CONFIG = {
  default_shadow_timeout_seconds: 300,
  default_shadow_model: null,
  default_thinking_level: "max",
  max_trajectory_chars: null, // null = no truncation
  auto_review_enabled: false,
  auto_review_exts: [...MAINSTREAM_EXTS],
};

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validate(raw) {
  const value = raw ?? {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("config must be a JSON object");
  const result = { ...DEFAULT_CONFIG };
  const positive = (name, fallback) => {
    const input = value[name];
    if (input === undefined) return fallback;
    if (!isFiniteNumber(input) || input <= 0) throw new Error(`${name} must be positive`);
    return input;
  };
  result.default_shadow_timeout_seconds = positive("default_shadow_timeout_seconds", DEFAULT_CONFIG.default_shadow_timeout_seconds);
  result.default_shadow_model = (() => {
    const input = value.default_shadow_model;
    if (input === undefined || input === null) return null;
    if (typeof input !== "string" || !input.trim()) throw new Error("default_shadow_model must be a non-empty string or null");
    return input.trim();
  })();
  const thinking = value.default_thinking_level ?? DEFAULT_CONFIG.default_thinking_level;
  if (!THINKING_LEVELS.has(thinking)) throw new Error("default_thinking_level is invalid");
  result.default_thinking_level = thinking;
  result.max_trajectory_chars = (() => {
    const input = value.max_trajectory_chars;
    if (input === undefined || input === null) return null;
    if (!isFiniteNumber(input) || !Number.isInteger(input) || input < 0) {
      throw new Error("max_trajectory_chars must be a non-negative integer or null");
    }
    return input;
  })();
  result.auto_review_enabled = value.auto_review_enabled === undefined
    ? DEFAULT_CONFIG.auto_review_enabled
    : Boolean(value.auto_review_enabled);
  result.auto_review_exts = (() => {
    const input = value.auto_review_exts;
    if (input === undefined || input === null) return [...DEFAULT_CONFIG.auto_review_exts];
    if (!Array.isArray(input)) throw new Error("auto_review_exts must be an array of extension strings like 'py' or '.py'");
    for (const item of input) {
      if (typeof item !== "string") throw new Error("auto_review_exts must be an array of extension strings like 'py' or '.py'");
      const text = item.trim();
      const core = text.startsWith(".") ? text.slice(1) : text;
      if (!/^[a-z0-9]+$/i.test(core)) throw new Error("auto_review_exts must be an array of extension strings like 'py' or '.py'");
    }
    return normalizeExts(input);
  })();
  return result;
}

export class ConfigStore {
  constructor() {
    this.configPath = configPath;
    this.lastGood = { ...DEFAULT_CONFIG };
    this.lastError = undefined;
  }

  async initialize() {
    await mkdir(dirname(this.configPath), { recursive: true });
    try {
      await readFile(this.configPath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(this.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
    }
    await this.reload();
  }

  async reload() {
    try {
      const raw = await readFile(this.configPath, "utf8");
      this.lastGood = validate(JSON.parse(raw));
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
    return { config: this.lastGood, error: this.lastError };
  }

  get current() {
    return this.lastGood;
  }

  get error() {
    return this.lastError;
  }

  async write(config) {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    this.lastGood = config;
    this.lastError = undefined;
  }
}

export { validate as validateConfig };
