/**
 * Configuration loading for witness.
 *
 * Loads rule config from (first match wins):
 *   1. .witness.json in project root (cwd)
 *   2. Built-in defaults
 *
 * Format:
 *   { "rules": { "no_edit_unread": "warn", "test_after_edits": ["warn", { "threshold": 3 }] } }
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { RuleAction, RuleConfig } from "./rules/Rule.js"

export interface WitnessConfig {
  readonly rules: Record<string, RuleConfig>
}

export const DEFAULT_CONFIG: WitnessConfig = {
  rules: {
    no_edit_unread: { action: "off", options: {} },
    fix_regressions_first: { action: "off", options: {} },
    test_after_edits: { action: "off", options: { threshold: 3 } },
    no_thrashing: { action: "off", options: { threshold: 3 } },
    no_commit_failing: { action: "off", options: {} },
    no_pointless_rerun: { action: "off", options: {} },
    scope_check: { action: "off", options: {} },
  },
}

/**
 * Parse a single rule config entry.
 *   "warn"                       → { action: "warn", options: {} }
 *   ["warn", { threshold: 5 }]  → { action: "warn", options: { threshold: 5 } }
 */
const parseRuleEntry = (entry: unknown): RuleConfig | null => {
  if (typeof entry === "string") {
    if (entry === "block" || entry === "warn" || entry === "off") {
      return { action: entry, options: {} }
    }
    return null
  }
  if (Array.isArray(entry) && entry.length >= 1) {
    const action = entry[0] as string
    if (action !== "block" && action !== "warn" && action !== "off") return null
    const options =
      entry.length >= 2 && typeof entry[1] === "object" && entry[1] !== null
        ? (entry[1] as Record<string, unknown>)
        : {}
    return { action: action as RuleAction, options }
  }
  return null
}

/**
 * Load config from .witness.json, merging with defaults.
 * Returns defaults on any failure (missing file, parse error, etc.).
 */
export const loadConfig = (cwd?: string): WitnessConfig => {
  const configPath = resolve(cwd ?? ".", ".witness.json")
  try {
    const raw = readFileSync(configPath, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("rules" in parsed) ||
      typeof (parsed as Record<string, unknown>).rules !== "object" ||
      (parsed as Record<string, unknown>).rules === null
    ) {
      return DEFAULT_CONFIG
    }
    const fileRules = (parsed as { rules: Record<string, unknown> }).rules
    const merged: Record<string, RuleConfig> = {}

    // Start with defaults
    for (const [name, config] of Object.entries(DEFAULT_CONFIG.rules)) {
      merged[name] = config
    }

    // Override with file config
    for (const [name, entry] of Object.entries(fileRules)) {
      const config = parseRuleEntry(entry)
      if (config) {
        const defaultOpts = DEFAULT_CONFIG.rules[name]?.options ?? {}
        merged[name] = {
          action: config.action,
          options: { ...defaultOpts, ...config.options },
        }
      }
    }

    return { rules: merged }
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Get the config for a specific rule, falling back to defaults.
 */
export const getRuleConfig = (
  config: WitnessConfig,
  ruleName: string
): RuleConfig => config.rules[ruleName] ?? { action: "off", options: {} }
