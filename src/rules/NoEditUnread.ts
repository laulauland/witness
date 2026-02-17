/**
 * Rule: no_edit_unread
 *
 * Don't edit what you haven't read.
 *
 * Fires on: Edit, Write, str_replace_editor
 * Condition: Target file has no read event in file_events for the current session.
 *
 * This is a PreToolUse check — the edit hasn't happened yet.
 * We check if the agent has ever read this file in the current session.
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
 * Handles various field names: path, file_path, file, filename.
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

export const NoEditUnread: LintRule = {
  name: "no_edit_unread",

  appliesTo: (input) => EDIT_TOOLS.has(input.tool_name),

  check: (input, sessionId, _options) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const filePath = extractPath(input.tool_input)
      if (!filePath) return null

      // Check if the file has been read in this session
      const rows = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt FROM file_events
        WHERE session_id = ${sessionId}
          AND file_path = ${filePath}
          AND event = 'read'
      `

      if (rows[0]!.cnt === 0) {
        return `${filePath} has not been read this session. Read it first to understand the current state.`
      }

      return null
    }),
}
