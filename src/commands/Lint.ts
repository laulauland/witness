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
import { insertHookEvent } from "../HookEvents.js"
import { applySchema } from "../Schema.js"
import { loadConfig, getRuleConfig } from "../Config.js"
import type { HookInput } from "../parsers/Parser.js"
import { allRules } from "../rules/index.js"
import type { RuleViolation } from "../rules/Rule.js"
import { tick } from "../Clock.js"

const DEFAULT_SESSION_ID = "default"

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

const truncate = (text: string, maxChars: number = 4000): string =>
  text.length <= maxChars ? text : `${text.slice(0, maxChars - 3)}...`

const parseRawObject = (raw: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Parse a JSON object into HookInput. Returns null on failure.
 */
const parseHookInput = (parsed: Record<string, unknown> | null): HookInput | null => {
  if (!parsed) return null
  if (typeof parsed.tool_name !== "string") return null

  return {
    hook: typeof parsed.hook === "string" ? parsed.hook : undefined,
    session_id: typeof parsed.session_id === "string" ? parsed.session_id : undefined,
    tool_name: parsed.tool_name,
    tool_input:
      typeof parsed.tool_input === "object" && parsed.tool_input !== null
        ? (parsed.tool_input as Record<string, unknown>)
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
}

const resolveSessionId = (
  explicitSessionId: string | undefined,
  envSessionId: string | undefined,
  parsed: Record<string, unknown> | null
): string => {
  if (explicitSessionId && explicitSessionId.length > 0) return explicitSessionId
  if (envSessionId && envSessionId.length > 0) return envSessionId

  const stdinSession = parsed?.session_id
  if (typeof stdinSession === "string" && stdinSession.length > 0) {
    return stdinSession
  }

  return DEFAULT_SESSION_ID
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

const logLintEvent = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  toolName: string | null,
  action: string,
  message: string | null,
  payload: string | null,
  result: string | null
): Effect.Effect<void, never, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const eventT = yield* tick(sessionId)
    yield* insertHookEvent(sql, {
      session_id: sessionId,
      t: eventT,
      event: "lint",
      tool_name: toolName,
      action,
      message,
      payload,
      result,
    })
  }).pipe(
    Effect.asVoid,
    Effect.catchAll(() => Effect.void)
  )

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
    const parsed = parseRawObject(raw)
    const input = parseHookInput(parsed)
    const sql = yield* SqlClient.SqlClient
    const sid = resolveSessionId(sessionId, process.env.WITNESS_SESSION, parsed)

    if (!input) {
      yield* logLintEvent(
        sql,
        sid,
        null,
        "parse_error",
        "failed to parse hook input",
        truncate(raw),
        null
      )
      return ""
    }

    const config = loadConfig(configDir)

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

    const payload = truncate(
      JSON.stringify({ tool_name: input.tool_name, tool_input: input.tool_input })
    )

    if (violations.length === 0) {
      yield* logLintEvent(sql, sid, input.tool_name, "allow", null, payload, null)
      return ""
    }

    // Block takes precedence over warn. First block wins.
    const blockViolation = violations.find((v) => v.action === "block")
    if (blockViolation) {
      const output = formatBlock(blockViolation)
      yield* logLintEvent(
        sql,
        sid,
        input.tool_name,
        "block",
        `${blockViolation.ruleName}: ${blockViolation.message}`,
        payload,
        truncate(output)
      )
      return output
    }

    // All remaining violations are warns
    const output = formatWarn(violations)
    yield* logLintEvent(
      sql,
      sid,
      input.tool_name,
      "warn",
      violations.map((v) => `${v.ruleName}: ${v.message}`).join(" | "),
      payload,
      truncate(output)
    )

    return output
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
