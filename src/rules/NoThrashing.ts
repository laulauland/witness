/**
 * Rule: no_thrashing
 *
 * If you've tried 3 times and it's still broken, stop and think.
 *
 * Fires on: Edit, Write, str_replace_editor
 * Condition: Target file appears in thrashing view with edit_count >= threshold.
 *
 * This is one of the few rules that defaults to BLOCK.
 * A thrashing agent will continue thrashing until stopped.
 *
 * Resets when: Tests pass after an edit (the edit cycle succeeds).
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

export const NoThrashing: LintRule = {
  name: "no_thrashing",

  appliesTo: (input) => EDIT_TOOLS.has(input.tool_name),

  check: (input, sessionId, options) =>
    Effect.gen(function* () {
      const threshold =
        typeof options?.threshold === "number"
          ? options.threshold
          : DEFAULT_THRESHOLD

      const filePath = extractPath(input.tool_input)
      if (!filePath) return null

      const sql = yield* SqlClient.SqlClient

      const rows = yield* sql<{ edit_count: number }>`
        SELECT edit_count FROM thrashing
        WHERE session_id = ${sessionId}
          AND file_path = ${filePath}
      `

      if (rows.length === 0) return null

      const editCount = rows[0]!.edit_count
      if (editCount >= threshold) {
        return `${filePath} has been edited ${editCount} times with failures persisting. Stop and reconsider your approach.`
      }

      return null
    }),
}
