/**
 * Rule: test_after_edits
 *
 * Don't make many changes without checking if they work.
 *
 * Fires on: Edit, Write, str_replace_editor
 * Condition: Count of file edit events since last test run >= threshold (default 3).
 *
 * Uses the edits_since_last_test view to check how many edits
 * have occurred since the last test command in the session.
 */
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import type { LintRule } from "./Rule.js"

const EDIT_TOOLS = new Set([
  "Edit",
  "edit",
  "str_replace_editor",
  "Write",
  "write",
  "file_create",
  "create_file",
])

const DEFAULT_THRESHOLD = 3

export const TestAfterEdits: LintRule = {
  name: "test_after_edits",

  appliesTo: (input) => EDIT_TOOLS.has(input.tool_name),

  check: (_input, sessionId, options) =>
    Effect.gen(function* () {
      const threshold =
        typeof options?.threshold === "number"
          ? options.threshold
          : DEFAULT_THRESHOLD

      const sql = yield* SqlClient.SqlClient

      const rows = yield* sql<{ edit_count: number }>`
        SELECT edit_count FROM edits_since_last_test
        WHERE session_id = ${sessionId}
      `

      const editCount = rows.length > 0 ? rows[0]!.edit_count : 0

      if (editCount >= threshold) {
        return `${editCount} edits since last test run. Run tests to verify your changes.`
      }

      return null
    }),
}
