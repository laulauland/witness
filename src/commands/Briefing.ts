/**
 * `witness briefing` — Generate a markdown situational summary.
 *
 * Sections (omitted when empty):
 *   - Header with logical clock position
 *   - Tests: pass/fail counts + failing test details
 *   - Regressions: which edits broke which tests
 *   - Thrashing: files stuck in edit-fail loops
 *   - Untested: files edited but not tested
 *   - Session stats: total edits, clock position
 *
 * Output goes to stdout as readable markdown.
 */
import { Command } from "@effect/cli"
import { SqlClient } from "@effect/sql"
import type { SqlError } from "@effect/sql/SqlError"
import { Console, Effect } from "effect"
import { currentTick } from "../Clock.js"
import { DbLive } from "../Db.js"
import { applySchema } from "../Schema.js"

const SESSION_ID = process.env.WITNESS_SESSION ?? "default"

// ── Query helpers ─────────────────────────────────────────────

interface FailingTest {
  test_name: string
  message: string | null
  t: number
}

interface Regression {
  test_name: string
  message: string | null
  likely_cause: string
  pass_t: number
  edit_t: number
  fail_t: number
}

interface ThrashingFile {
  file_path: string
  edit_count: number
  last_edit_t: number
}

interface UntestedEdit {
  file_path: string
  last_edit_t: number
}

interface TestStateCounts {
  passing: number
  failing: number
}

interface SessionStats {
  totalEdits: number
  totalToolCalls: number
  clockPosition: number
}

// ── Briefing generator (factored out for testability) ─────────

export const generateBriefing = (
  sessionId: string
): Effect.Effect<string, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // Clock position
    const clockPos = yield* currentTick(sessionId)

    // Failing tests
    const failing = yield* sql<FailingTest>`
      SELECT test_name, message, t FROM failing_tests
      WHERE session_id = ${sessionId}
      ORDER BY t DESC
    `

    // Passing tests count
    const passingRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM current_test_state
      WHERE session_id = ${sessionId} AND outcome = 'pass'
    `
    const passingCount = passingRows[0]?.cnt ?? 0

    // Regressions
    const regressions = yield* sql<Regression>`
      SELECT test_name, message, likely_cause, pass_t, edit_t, fail_t
      FROM regressions
      WHERE session_id = ${sessionId}
      ORDER BY fail_t DESC
    `

    // Thrashing files
    const thrashing = yield* sql<ThrashingFile>`
      SELECT file_path, edit_count, last_edit_t
      FROM thrashing
      WHERE session_id = ${sessionId}
      ORDER BY edit_count DESC
    `

    // Untested edits
    const untested = yield* sql<UntestedEdit>`
      SELECT file_path, last_edit_t
      FROM untested_edits
      WHERE session_id = ${sessionId}
      ORDER BY last_edit_t DESC
    `

    // Session stats
    const editCountRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM file_events
      WHERE session_id = ${sessionId} AND event = 'edit'
    `
    const totalEdits = editCountRows[0]?.cnt ?? 0

    const toolCallRows = yield* sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM tool_calls
      WHERE session_id = ${sessionId}
    `
    const totalToolCalls = toolCallRows[0]?.cnt ?? 0

    // Build markdown output
    return formatBriefing({
      clockPosition: clockPos,
      failing: [...failing],
      passingCount,
      regressions: [...regressions],
      thrashing: [...thrashing],
      untested: [...untested],
      stats: { totalEdits, totalToolCalls, clockPosition: clockPos },
    })
  })

// ── Formatting ────────────────────────────────────────────────

interface BriefingData {
  clockPosition: number
  failing: FailingTest[]
  passingCount: number
  regressions: Regression[]
  thrashing: ThrashingFile[]
  untested: UntestedEdit[]
  stats: SessionStats
}

export const formatBriefing = (data: BriefingData): string => {
  const lines: string[] = []

  // Header
  lines.push(`## Witness Briefing (t=${data.clockPosition})`)
  lines.push("")

  // Tests section — show if any test data exists
  const hasTestData = data.failing.length > 0 || data.passingCount > 0
  if (hasTestData) {
    lines.push("### Tests")
    lines.push("")
    lines.push(`- **Passing**: ${data.passingCount}`)
    lines.push(`- **Failing**: ${data.failing.length}`)

    if (data.failing.length > 0) {
      lines.push("")
      for (const t of data.failing) {
        const msg = t.message ? `: ${t.message}` : ""
        lines.push(`  - \`${t.test_name}\`${msg}`)
      }
    }
    lines.push("")
  }

  // Regressions section
  if (data.regressions.length > 0) {
    lines.push("### Regressions")
    lines.push("")
    for (const r of data.regressions) {
      const msg = r.message ? ` — ${r.message}` : ""
      lines.push(`- \`${r.test_name}\` broke after editing \`${r.likely_cause}\`${msg}`)
    }
    lines.push("")
  }

  // Thrashing section
  if (data.thrashing.length > 0) {
    lines.push("### Thrashing")
    lines.push("")
    for (const t of data.thrashing) {
      lines.push(`- \`${t.file_path}\` — ${t.edit_count} edits with persistent failures`)
    }
    lines.push("")
  }

  // Untested section
  if (data.untested.length > 0) {
    lines.push("### Untested Edits")
    lines.push("")
    for (const u of data.untested) {
      lines.push(`- \`${u.file_path}\``)
    }
    lines.push("")
  }

  // Session stats (always shown)
  lines.push("### Session Stats")
  lines.push("")
  lines.push(`- **Clock position**: ${data.stats.clockPosition}`)
  lines.push(`- **Total edits**: ${data.stats.totalEdits}`)
  lines.push(`- **Total tool calls**: ${data.stats.totalToolCalls}`)

  return lines.join("\n")
}

// ── Command ───────────────────────────────────────────────────

export const BriefingCommand = Command.make("briefing", {}, () =>
  Effect.gen(function* () {
    const output = yield* Effect.gen(function* () {
      yield* applySchema
      return yield* generateBriefing(SESSION_ID)
    }).pipe(Effect.provide(DbLive))

    yield* Console.log(output)
  }).pipe(
    Effect.catchAll((error) =>
      Console.error(`witness briefing: error: ${String(error)}`)
    ),
    Effect.catchAllDefect((defect) =>
      Console.error(`witness briefing: defect: ${String(defect)}`)
    )
  )
).pipe(Command.withDescription("Print a situational briefing summary"))
