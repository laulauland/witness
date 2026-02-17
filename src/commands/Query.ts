/**
 * `witness query <name> [arg]` — Named query dispatcher.
 *
 * Queries:
 *   failing          — currently failing tests with messages
 *   passing          — currently passing tests
 *   regressions      — with likely cause file
 *   thrashing        — files in thrashing state
 *   history <file>   — edit timeline
 *   test-history <t> — pass/fail timeline
 *   untested         — edited but not tested files
 *   lint             — current lint/type errors
 *   fixes            — edits that fixed tests
 *   clusters         — error clusters
 *   timeline [n]     — last n tool calls (default 20)
 *   stats            — session summary
 *   blast <file>     — transitive reverse dependencies
 *   deps <file>      — transitive forward dependencies
 */
import { Args, Command } from "@effect/cli"
import { SqlClient } from "@effect/sql"
import type { SqlError } from "@effect/sql/SqlError"
import { Console, Effect, Option } from "effect"
import { currentTick } from "../Clock.js"
import { DbLive } from "../Db.js"
import { applySchema } from "../Schema.js"

const SESSION_ID = process.env.WITNESS_SESSION ?? "default"

// ── Query implementations ─────────────────────────────────────

const queryFailing = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ test_name: string; message: string | null; t: number }>`
      SELECT test_name, message, t FROM failing_tests
      WHERE session_id = ${sessionId}
      ORDER BY t DESC
    `
    if (rows.length === 0) return "No failing tests."
    const lines = rows.map((r) => {
      const msg = r.message ? `: ${r.message}` : ""
      return `- \`${r.test_name}\`${msg}`
    })
    return `**Failing Tests (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryPassing = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ test_name: string; t: number }>`
      SELECT test_name, t FROM current_test_state
      WHERE session_id = ${sessionId} AND outcome = 'pass'
      ORDER BY test_name
    `
    if (rows.length === 0) return "No passing tests."
    const lines = rows.map((r) => `- \`${r.test_name}\``)
    return `**Passing Tests (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryRegressions = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      test_name: string
      message: string | null
      likely_cause: string
      pass_t: number
      edit_t: number
      fail_t: number
    }>`
      SELECT test_name, message, likely_cause, pass_t, edit_t, fail_t
      FROM regressions
      WHERE session_id = ${sessionId}
      ORDER BY fail_t DESC
    `
    if (rows.length === 0) return "No regressions detected."
    const lines = rows.map((r) => {
      const msg = r.message ? ` — ${r.message}` : ""
      return `- \`${r.test_name}\` broke after editing \`${r.likely_cause}\` (pass@t=${r.pass_t} → edit@t=${r.edit_t} → fail@t=${r.fail_t})${msg}`
    })
    return `**Regressions (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryThrashing = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      file_path: string
      edit_count: number
      last_edit_t: number
    }>`
      SELECT file_path, edit_count, last_edit_t
      FROM thrashing
      WHERE session_id = ${sessionId}
      ORDER BY edit_count DESC
    `
    if (rows.length === 0) return "No thrashing files."
    const lines = rows.map(
      (r) => `- \`${r.file_path}\` — ${r.edit_count} edits with persistent failures`
    )
    return `**Thrashing Files (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryHistory = (
  sessionId: string,
  filePath: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      t: number
      event: string
      ts: string
    }>`
      SELECT t, event, ts FROM file_events
      WHERE session_id = ${sessionId} AND file_path = ${filePath}
      ORDER BY t ASC
    `
    if (rows.length === 0) return `No history for \`${filePath}\`.`
    const lines = rows.map((r) => `- t=${r.t} **${r.event}** (${r.ts})`)
    return `**History for \`${filePath}\`**\n\n${lines.join("\n")}`
  })

const queryTestHistory = (
  sessionId: string,
  testName: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      t: number
      outcome: string
      message: string | null
      ts: string
    }>`
      SELECT t, outcome, message, ts FROM test_results
      WHERE session_id = ${sessionId} AND test_name = ${testName}
      ORDER BY t ASC
    `
    if (rows.length === 0) return `No test history for \`${testName}\`.`
    const lines = rows.map((r) => {
      const icon = r.outcome === "pass" ? "✅" : r.outcome === "fail" ? "❌" : "⏭️"
      const msg = r.message ? ` — ${r.message}` : ""
      return `- t=${r.t} ${icon} **${r.outcome}**${msg} (${r.ts})`
    })
    return `**Test History for \`${testName}\`**\n\n${lines.join("\n")}`
  })

const queryUntested = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ file_path: string; last_edit_t: number }>`
      SELECT file_path, last_edit_t FROM untested_edits
      WHERE session_id = ${sessionId}
      ORDER BY last_edit_t DESC
    `
    if (rows.length === 0) return "No untested edits."
    const lines = rows.map((r) => `- \`${r.file_path}\` (last edit at t=${r.last_edit_t})`)
    return `**Untested Edits (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryLint = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const lintRows = yield* sql<{
      file_path: string
      line: number | null
      rule: string
      severity: string
      t: number
    }>`
      SELECT file_path, line, rule, severity, t FROM lint_results
      WHERE session_id = ${sessionId}
      ORDER BY t DESC, file_path, line
    `

    const typeRows = yield* sql<{
      file_path: string
      line: number | null
      message: string
      t: number
    }>`
      SELECT file_path, line, message, t FROM type_errors
      WHERE session_id = ${sessionId}
      ORDER BY t DESC, file_path, line
    `

    if (lintRows.length === 0 && typeRows.length === 0) {
      return "No lint or type errors."
    }

    const parts: string[] = []

    if (lintRows.length > 0) {
      const lines = lintRows.map((r) => {
        const loc = r.line ? `:${r.line}` : ""
        return `- \`${r.file_path}${loc}\` [${r.severity}] ${r.rule}`
      })
      parts.push(`**Lint Errors (${lintRows.length})**\n\n${lines.join("\n")}`)
    }

    if (typeRows.length > 0) {
      const lines = typeRows.map((r) => {
        const loc = r.line ? `:${r.line}` : ""
        return `- \`${r.file_path}${loc}\` ${r.message}`
      })
      parts.push(`**Type Errors (${typeRows.length})**\n\n${lines.join("\n")}`)
    }

    return parts.join("\n\n")
  })

const queryFixes = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      file_path: string
      test_name: string
      edit_t: number
      fail_t: number
      fix_t: number
    }>`
      SELECT file_path, test_name, edit_t, fail_t, fix_t
      FROM likely_fixes
      WHERE session_id = ${sessionId}
      ORDER BY fix_t DESC
    `
    if (rows.length === 0) return "No fixes detected."
    const lines = rows.map(
      (r) =>
        `- \`${r.file_path}\` fixed \`${r.test_name}\` (edit@t=${r.edit_t} → fix@t=${r.fix_t})`
    )
    return `**Likely Fixes (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryClusters = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      message: string
      test_count: number
      tests: string
    }>`
      SELECT message, test_count, tests
      FROM error_clusters
      WHERE session_id = ${sessionId}
      ORDER BY test_count DESC
    `
    if (rows.length === 0) return "No error clusters."
    const lines = rows.map(
      (r) => `- **${r.test_count} tests** share: "${r.message}"\n  Tests: ${r.tests}`
    )
    return `**Error Clusters (${rows.length})**\n\n${lines.join("\n")}`
  })

const queryTimeline = (
  sessionId: string,
  limit: number
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      t: number
      tool_name: string
      tool_input: string | null
      ts: string
    }>`
      SELECT t, tool_name, tool_input, ts FROM tool_calls
      WHERE session_id = ${sessionId}
      ORDER BY t DESC
      LIMIT ${limit}
    `
    if (rows.length === 0) return "No tool calls recorded."
    const lines = rows.map((r) => {
      let summary = r.tool_name
      if (r.tool_input) {
        try {
          const input = JSON.parse(r.tool_input)
          if (input.path) summary += ` ${input.path}`
          else if (input.command) {
            const cmd = String(input.command)
            summary += ` \`${cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd}\``
          }
        } catch {
          // ignore
        }
      }
      return `- t=${r.t} **${summary}** (${r.ts})`
    })
    return `**Timeline (last ${limit})**\n\n${lines.join("\n")}`
  })

const queryStats = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const clockPos = yield* currentTick(sessionId)

    const toolCallRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM tool_calls WHERE session_id = ${sessionId}
    `
    const editRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM file_events WHERE session_id = ${sessionId} AND event = 'edit'
    `
    const readRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM file_events WHERE session_id = ${sessionId} AND event = 'read'
    `
    const testRunRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(DISTINCT t) AS cnt FROM test_results WHERE session_id = ${sessionId}
    `
    const passingRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM current_test_state
      WHERE session_id = ${sessionId} AND outcome = 'pass'
    `
    const failingRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM current_test_state
      WHERE session_id = ${sessionId} AND outcome = 'fail'
    `
    const uniqueFilesRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(DISTINCT file_path) AS cnt FROM file_events WHERE session_id = ${sessionId}
    `

    const lines = [
      "**Session Stats**",
      "",
      `- **Clock position**: ${clockPos}`,
      `- **Tool calls**: ${toolCallRows[0]?.cnt ?? 0}`,
      `- **File edits**: ${editRows[0]?.cnt ?? 0}`,
      `- **File reads**: ${readRows[0]?.cnt ?? 0}`,
      `- **Unique files**: ${uniqueFilesRows[0]?.cnt ?? 0}`,
      `- **Test runs**: ${testRunRows[0]?.cnt ?? 0}`,
      `- **Tests passing**: ${passingRows[0]?.cnt ?? 0}`,
      `- **Tests failing**: ${failingRows[0]?.cnt ?? 0}`,
    ]
    return lines.join("\n")
  })

const queryBlast = (
  sessionId: string,
  filePath: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ dependent: string; depth: number }>`
      SELECT DISTINCT source_file AS dependent, MIN(depth) AS depth
      FROM depends_on
      WHERE session_id = ${sessionId}
        AND imported_module = ${filePath}
      GROUP BY source_file
      ORDER BY depth ASC, source_file ASC
    `
    if (rows.length === 0) return `No files depend on \`${filePath}\`.`
    const lines = rows.map(
      (r) => `- \`${r.dependent}\` (depth ${r.depth})`
    )
    return `**Blast Radius for \`${filePath}\` (${rows.length} dependents)**\n\n${lines.join("\n")}`
  })

const queryDeps = (
  sessionId: string,
  filePath: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ dependency: string; depth: number }>`
      SELECT DISTINCT imported_module AS dependency, MIN(depth) AS depth
      FROM depends_on
      WHERE session_id = ${sessionId}
        AND source_file = ${filePath}
      GROUP BY imported_module
      ORDER BY depth ASC, imported_module ASC
    `
    if (rows.length === 0) return `\`${filePath}\` has no known dependencies.`
    const lines = rows.map(
      (r) => `- \`${r.dependency}\` (depth ${r.depth})`
    )
    return `**Dependencies of \`${filePath}\` (${rows.length})**\n\n${lines.join("\n")}`
  })

// ── Query dispatcher (factored out for testability) ───────────

/**
 * Dispatch a named query. Returns the formatted output string.
 */
export const dispatchQuery = (
  queryName: string,
  arg: string | undefined,
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> => {
  switch (queryName) {
    case "failing":
      return queryFailing(sessionId)
    case "passing":
      return queryPassing(sessionId)
    case "regressions":
      return queryRegressions(sessionId)
    case "thrashing":
      return queryThrashing(sessionId)
    case "history": {
      if (!arg) return Effect.succeed("Usage: witness query history <file>")
      return queryHistory(sessionId, arg)
    }
    case "test-history": {
      if (!arg) return Effect.succeed("Usage: witness query test-history <test>")
      return queryTestHistory(sessionId, arg)
    }
    case "untested":
      return queryUntested(sessionId)
    case "lint":
      return queryLint(sessionId)
    case "fixes":
      return queryFixes(sessionId)
    case "clusters":
      return queryClusters(sessionId)
    case "timeline": {
      const n = arg ? parseInt(arg, 10) : 20
      const limit = Number.isFinite(n) && n > 0 ? n : 20
      return queryTimeline(sessionId, limit)
    }
    case "stats":
      return queryStats(sessionId)
    case "blast": {
      if (!arg) return Effect.succeed("Usage: witness query blast <file>")
      return queryBlast(sessionId, arg)
    }
    case "deps": {
      if (!arg) return Effect.succeed("Usage: witness query deps <file>")
      return queryDeps(sessionId, arg)
    }
    default:
      return Effect.succeed(
        `Unknown query: "${queryName}". Available: failing, passing, regressions, thrashing, history, test-history, untested, lint, fixes, clusters, timeline, stats, blast, deps`
      )
  }
}

// ── Command ───────────────────────────────────────────────────

const queryNameArg = Args.text({ name: "name" }).pipe(
  Args.withDescription("Named query to run")
)

const queryArgArg = Args.text({ name: "arg" }).pipe(
  Args.withDescription("Optional argument (file path, test name, count)"),
  Args.optional
)

export const QueryCommand = Command.make(
  "query",
  { queryName: queryNameArg, queryArg: queryArgArg },
  ({ queryName, queryArg }) =>
    Effect.gen(function* () {
      const output = yield* Effect.gen(function* () {
        yield* applySchema
        const arg = Option.getOrUndefined(queryArg)
        return yield* dispatchQuery(queryName, arg, SESSION_ID)
      }).pipe(Effect.provide(DbLive))

      yield* Console.log(output)
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`witness query: error: ${String(error)}`)
      ),
      Effect.catchAllDefect((defect) =>
        Console.error(`witness query: defect: ${String(defect)}`)
      )
    )
).pipe(
  Command.withDescription(
    "Run a named query (failing, passing, regressions, thrashing, history, test-history, untested, lint, fixes, clusters, timeline, stats, blast, deps)"
  )
)
