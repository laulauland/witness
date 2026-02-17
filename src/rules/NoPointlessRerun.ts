/**
 * Rule: no_pointless_rerun
 *
 * Don't re-run tests expecting different results.
 *
 * Fires on: Bash matching test command patterns.
 * Condition: edits_since_last_test = 0 AND prior test results exist in the session.
 *
 * First test run of the session always passes (no prior results).
 */
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import type { LintRule } from "./Rule.js"

const TEST_PATTERN =
  /\b(jest|vitest|mocha|pytest|go\s+test|cargo\s+test|bun\s+test|npm\s+test|yarn\s+test|pnpm\s+test)\b/i

const isBashTool = (toolName: string): boolean =>
  toolName === "Bash" ||
  toolName === "bash" ||
  toolName === "terminal" ||
  toolName === "execute_command"

const extractCommand = (toolInput: Record<string, unknown>): string => {
  if (typeof toolInput.command === "string") return toolInput.command
  if (typeof toolInput.cmd === "string") return toolInput.cmd
  return ""
}

export const NoPointlessRerun: LintRule = {
  name: "no_pointless_rerun",

  appliesTo: (input) => {
    if (!isBashTool(input.tool_name)) return false
    const command = extractCommand(input.tool_input)
    return TEST_PATTERN.test(command)
  },

  check: (_input, sessionId, _options) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Check if there are any prior test results in this session
      const priorResults = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt FROM test_results
        WHERE session_id = ${sessionId}
      `

      // First test run of the session → always allow
      if (priorResults[0]!.cnt === 0) return null

      // Check if there are any edits since the last test
      const editsSince = yield* sql<{ edit_count: number }>`
        SELECT edit_count FROM edits_since_last_test
        WHERE session_id = ${sessionId}
      `

      // If edits_since_last_test has no rows, it means zero edits since last test
      if (editsSince.length === 0) {
        return "No edits since last test run. Change something before re-running tests."
      }

      // There are edits since the last test → allow
      return null
    }),
}
