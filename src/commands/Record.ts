/**
 * `witness record` — PostToolUse hook handler.
 *
 * Reads JSON from stdin, records facts into the DB.
 * EXIT 0 ALWAYS. Never crash, never block the agent.
 *
 * Flow:
 *   1. Read stdin as text
 *   2. Parse as JSON → HookInput
 *   3. Always insert a tool_calls row (raw log)
 *   4. Route to parser for structured facts (e.g., FileEvent)
 *   5. Insert structured facts with clock tick
 *   6. Exit 0
 *
 * On any error (parse, SQL, anything): log to stderr, exit 0.
 */
import { Command } from "@effect/cli"
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { tick } from "../Clock.js"
import type { Fact } from "../Facts.js"
import type { HookInput } from "../parsers/Parser.js"
import { routeWithInput } from "../parsers/index.js"
import { DbLive } from "../Db.js"
import { applySchema } from "../Schema.js"

const SESSION_ID = process.env.WITNESS_SESSION ?? "default"

/**
 * Read all of stdin as a string.
 */
const readStdin = Effect.tryPromise({
  try: async () => {
    // Use Bun's stdin reader
    const chunks: Uint8Array[] = []
    const reader = Bun.stdin.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const decoder = new TextDecoder()
    return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode()
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
      tool_input: typeof parsed.tool_input === "object" && parsed.tool_input !== null
        ? parsed.tool_input
        : {},
      tool_output: typeof parsed.tool_output === "string" ? parsed.tool_output : undefined,
      tool_exit_code: typeof parsed.tool_exit_code === "number" ? parsed.tool_exit_code : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Insert a tool_calls row.
 */
const insertToolCall = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  input: HookInput
) =>
  sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input, tool_output)
      VALUES (${sessionId}, ${t}, ${input.tool_name}, ${JSON.stringify(input.tool_input)}, ${input.tool_output ?? null})`

/**
 * Insert a FileEvent fact.
 */
const insertFileEvent = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Extract<Fact, { _tag: "FileEvent" }>
) =>
  sql`INSERT INTO file_events (session_id, t, event, file_path)
      VALUES (${sessionId}, ${t}, ${fact.event}, ${fact.file_path})`

/**
 * Insert a TestResult fact.
 */
const insertTestResult = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Extract<Fact, { _tag: "TestResult" }>
) =>
  sql`INSERT INTO test_results (session_id, t, test_name, outcome, message)
      VALUES (${sessionId}, ${t}, ${fact.test_name}, ${fact.outcome}, ${fact.message})`

/**
 * Insert a LintResult fact.
 */
const insertLintResult = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Extract<Fact, { _tag: "LintResult" }>
) =>
  sql`INSERT INTO lint_results (session_id, t, file_path, line, rule, severity)
      VALUES (${sessionId}, ${t}, ${fact.file_path}, ${fact.line}, ${fact.rule}, ${fact.severity})`

/**
 * Insert a TypeError fact.
 */
const insertTypeError = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Extract<Fact, { _tag: "TypeError" }>
) =>
  sql`INSERT INTO type_errors (session_id, t, file_path, line, message)
      VALUES (${sessionId}, ${t}, ${fact.file_path}, ${fact.line}, ${fact.message})`

/**
 * Insert an Import fact.
 */
const insertImport = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Extract<Fact, { _tag: "Import" }>
) =>
  sql`INSERT INTO imports (session_id, t, source_file, imported_module)
      VALUES (${sessionId}, ${t}, ${fact.source_file}, ${fact.imported_module})`

/**
 * Insert any structured fact. Dispatches by _tag.
 */
const insertFact = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  t: number,
  fact: Fact
): Effect.Effect<unknown, unknown, never> => {
  switch (fact._tag) {
    case "FileEvent":
      return insertFileEvent(sql, sessionId, t, fact)
    case "TestResult":
      return insertTestResult(sql, sessionId, t, fact)
    case "LintResult":
      return insertLintResult(sql, sessionId, t, fact)
    case "TypeError":
      return insertTypeError(sql, sessionId, t, fact)
    case "Import":
      return insertImport(sql, sessionId, t, fact)
    default:
      return Effect.void
  }
}

/**
 * The core record pipeline. Factored out for testability.
 */
export const recordPipeline = (
  raw: string
): Effect.Effect<void, never, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const input = parseHookInput(raw)
    if (!input) {
      yield* Effect.logDebug(`witness record: failed to parse input`)
      return
    }

    const sql = yield* SqlClient.SqlClient
    const sessionId = SESSION_ID

    // Always record the raw tool call
    const t = yield* tick(sessionId)
    yield* insertToolCall(sql, sessionId, t, input)

    // Route to parser for structured facts (use extended router with full input)
    const parser = routeWithInput(input)
    if (!parser) return

    const facts = parser(input)
    for (const fact of facts) {
      const factT = yield* tick(sessionId)
      yield* insertFact(sql, sessionId, factT, fact)
    }
  }).pipe(
    // Catch ALL errors — never crash
    Effect.catchAll((error) =>
      Effect.logDebug(`witness record: error: ${String(error)}`)
    )
  )

export const RecordCommand = Command.make("record", {}, () =>
  Effect.gen(function* () {
    const raw = yield* readStdin

    yield* Effect.gen(function* () {
      // Ensure tables/views exist even if `witness init` was not run.
      yield* applySchema
      yield* recordPipeline(raw)
    }).pipe(Effect.provide(DbLive))
  }).pipe(
    // Outer catch: even stdin read failure → exit 0
    Effect.catchAll((error) =>
      Effect.logDebug(`witness record: stdin error: ${String(error)}`)
    ),
    // Final safety net
    Effect.catchAllDefect((defect) =>
      Effect.logDebug(`witness record: defect: ${String(defect)}`)
    )
  )
).pipe(Command.withDescription("Record a tool call from PostToolUse hook (stdin JSON)"))
