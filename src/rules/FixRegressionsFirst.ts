/**
 * Rule: fix_regressions_first
 *
 * Fix what you broke before moving on.
 *
 * Fires on: Edit, Write
 * Condition: Regressions exist for files OTHER than the one being edited.
 *
 * Key nuance: Does NOT fire when editing the file that caused the regression.
 * The agent is presumably trying to fix it.
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

/**
 * Extract file path from tool_input.
 */
const extractPath = (
  toolInput: Record<string, unknown>
): string | undefined => {
  const candidates = ["path", "file_path", "file", "filename"]
  for (const key of candidates) {
    const val = toolInput[key]
    if (typeof val === "string" && val.length > 0) {
      return val
    }
  }
  return undefined
}

export const FixRegressionsFirst: LintRule = {
  name: "fix_regressions_first",

  appliesTo: (input) => EDIT_TOOLS.has(input.tool_name),

  check: (input, sessionId, _options) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const filePath = extractPath(input.tool_input)

      // Query regressions for OTHER files (not the one being edited)
      const rows = filePath
        ? yield* sql<{
            test_name: string
            likely_cause: string
            message: string | null
          }>`
            SELECT DISTINCT test_name, likely_cause, message FROM regressions
            WHERE session_id = ${sessionId}
              AND likely_cause != ${filePath}
          `
        : yield* sql<{
            test_name: string
            likely_cause: string
            message: string | null
          }>`
            SELECT DISTINCT test_name, likely_cause, message FROM regressions
            WHERE session_id = ${sessionId}
          `

      if (rows.length === 0) return null

      const items = rows
        .slice(0, 3)
        .map((r) => `${r.test_name} (after edit to ${r.likely_cause})`)
        .join("; ")
      const suffix = rows.length > 3 ? ` (and ${rows.length - 3} more)` : ""
      return `${rows.length} regression${rows.length === 1 ? "" : "s"} detected: ${items}${suffix}. Fix regressions before editing other files.`
    }),
}
