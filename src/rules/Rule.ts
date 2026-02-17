/**
 * LintRule interface — the contract every lint rule implements.
 *
 * - appliesTo: fast, sync check — does this rule care about this tool call?
 * - check: effectful query — returns a violation message or null (clean).
 *
 * check receives sessionId (for session-scoped queries) and optional
 * rule-specific options (e.g., threshold for test_after_edits).
 */
import type { SqlClient } from "@effect/sql"
import type * as SqlError from "@effect/sql/SqlError"
import type { Effect } from "effect"
import type { HookInput } from "../parsers/Parser.js"

export type RuleAction = "block" | "warn" | "off"

export interface RuleConfig {
  readonly action: RuleAction
  readonly options: Record<string, unknown>
}

export interface LintRule {
  readonly name: string
  readonly appliesTo: (input: HookInput) => boolean
  readonly check: (
    input: HookInput,
    sessionId: string,
    options?: Record<string, unknown>
  ) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
}

/**
 * Result of evaluating a single rule.
 */
export interface RuleViolation {
  readonly ruleName: string
  readonly action: RuleAction
  readonly message: string
}
