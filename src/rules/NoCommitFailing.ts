/**
 * Rule: no_commit_failing
 *
 * Never commit broken code.
 *
 * Fires on: Bash tool calls matching 'git commit' or 'jj' commit patterns.
 * Condition: failing_tests view is non-empty for the current session.
 *
 * Edge case: If no tests have been run this session, the rule does NOT fire
 * (no data = no known failures).
 */
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import type { LintRule } from "./Rule.js"

/**
 * Match Bash commands that are commit operations.
 */
const COMMIT_PATTERN = /\b(git\s+commit|jj\s+(commit|describe|new))\b/i

const isBashTool = (toolName: string): boolean =>
  toolName === "Bash" || toolName === "bash" || toolName === "terminal" || toolName === "execute_command"

const extractCommand = (toolInput: Record<string, unknown>): string => {
  if (typeof toolInput.command === "string") return toolInput.command
  if (typeof toolInput.cmd === "string") return toolInput.cmd
  return ""
}

export const NoCommitFailing: LintRule = {
  name: "no_commit_failing",

  appliesTo: (input) => {
    if (!isBashTool(input.tool_name)) return false
    const command = extractCommand(input.tool_input)
    return COMMIT_PATTERN.test(command)
  },

  check: (_input, sessionId, _options) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const rows = yield* sql<{ test_name: string; message: string | null }>`
        SELECT test_name, message FROM failing_tests
        WHERE session_id = ${sessionId}
      `

      if (rows.length === 0) return null

      const testNames = rows.map((r) => r.test_name).slice(0, 5)
      const suffix = rows.length > 5 ? ` (and ${rows.length - 5} more)` : ""
      return `${rows.length} test${rows.length === 1 ? "" : "s"} currently failing (${testNames.join(", ")}${suffix}). Fix tests before committing.`
    }),
}
