/**
 * `witness lint` — PreToolUse hook handler.
 *
 * Reads JSON from stdin, evaluates applicable lint rules, outputs:
 *   - No violations → exit 0, no output (allow)
 *   - Warn violations → exit 0, JSON with decision:approve + additionalContext
 *   - Block violation → exit 0, JSON with permissionDecision:deny
 *
 * EXIT 0 ALWAYS. Block/warn expressed in stdout JSON, never exit codes.
 */
import { Command } from "@effect/cli"
import { SqlClient } from "@effect/sql"
import { Console, Effect } from "effect"
import { DbLive } from "../Db.js"
import { applySchema } from "../Schema.js"
import { loadConfig, getRuleConfig } from "../Config.js"
import type { HookInput } from "../parsers/Parser.js"
import { allRules } from "../rules/index.js"
import type { RuleViolation } from "../rules/Rule.js"

const SESSION_ID = process.env.WITNESS_SESSION ?? "default"

/**
 * Read all of stdin as a string.
 */
const readStdin = Effect.tryPromise({
  try: async () => {
    const chunks: Uint8Array[] = []
    const reader = Bun.stdin.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const decoder = new TextDecoder()
    return (
      chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
      decoder.decode()
    )
  },
  catch: (e) => ({ _tag: "StdinError" as const, error: e }),
})

/**
 * Parse a JSON string into HookInput. Returns null on failure.
 */
const parseHookInput = (raw: string): HookInput | null => {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    if (typeof parsed.tool_name !== "string") return null
    return {
      hook: parsed.hook,
      tool_name: parsed.tool_name,
      tool_input:
        typeof parsed.tool_input === "object" && parsed.tool_input !== null
          ? parsed.tool_input
          : {},
      tool_output:
        typeof parsed.tool_output === "string"
          ? parsed.tool_output
          : undefined,
      tool_exit_code:
        typeof parsed.tool_exit_code === "number"
          ? parsed.tool_exit_code
          : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Format the warn output: approve with context message.
 */
const formatWarn = (violations: ReadonlyArray<RuleViolation>): string => {
  const messages = violations
    .map((v) => `[witness] ⚠️ ${v.ruleName}: ${v.message}`)
    .join("\n")
  return JSON.stringify({
    decision: "approve",
    additionalContext: messages,
  })
}

/**
 * Format the block output: deny with reason.
 */
const formatBlock = (violation: RuleViolation): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `[witness] 🛑 ${violation.ruleName}: ${violation.message}`,
    },
  })

/**
 * The core lint pipeline. Factored out for testability.
 *
 * Returns the stdout string (empty string = allow).
 */
export const lintPipeline = (
  raw: string,
  sessionId?: string,
  configDir?: string
): Effect.Effect<string, never, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const input = parseHookInput(raw)
    if (!input) return ""

    const config = loadConfig(configDir)
    const sid = sessionId ?? SESSION_ID

    // Collect violations from all applicable rules
    const violations: RuleViolation[] = []

    for (const rule of allRules) {
      const ruleConfig = getRuleConfig(config, rule.name)
      if (ruleConfig.action === "off") continue
      if (!rule.appliesTo(input)) continue

      const message = yield* rule.check(input, sid, ruleConfig.options).pipe(
        // If a rule query fails, treat as no violation (never crash)
        Effect.catchAll(() => Effect.succeed(null))
      )

      if (message !== null) {
        violations.push({
          ruleName: rule.name,
          action: ruleConfig.action,
          message,
        })
      }
    }

    if (violations.length === 0) return ""

    // Block takes precedence over warn. First block wins.
    const blockViolation = violations.find((v) => v.action === "block")
    if (blockViolation) {
      return formatBlock(blockViolation)
    }

    // All remaining violations are warns
    return formatWarn(violations)
  }).pipe(
    Effect.catchAll(() => Effect.succeed("")),
  )

export const LintCommand = Command.make("lint", {}, () =>
  Effect.gen(function* () {
    const raw = yield* readStdin

    const output = yield* Effect.gen(function* () {
      yield* applySchema
      return yield* lintPipeline(raw)
    }).pipe(Effect.provide(DbLive))

    if (output.length > 0) {
      yield* Console.log(output)
    }
  }).pipe(
    // Outer catch: even stdin read failure → exit 0
    Effect.catchAll((error) =>
      Effect.logDebug(`witness lint: error: ${String(error)}`)
    ),
    // Final safety net
    Effect.catchAllDefect((defect) =>
      Effect.logDebug(`witness lint: defect: ${String(defect)}`)
    )
  )
).pipe(
  Command.withDescription(
    "Evaluate lint rules against a PreToolUse hook (stdin JSON)"
  )
)
