/**
 * Rule: scope_check
 *
 * Stay focused on what you're working on.
 *
 * Fires on: Edit, Write, str_replace_editor
 * Condition: Target file is NOT in current blast radius AND has not been read.
 *
 * Default action is OFF (configured in Config.ts).
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

export const ScopeCheck: LintRule = {
  name: "scope_check",

  appliesTo: (input) => EDIT_TOOLS.has(input.tool_name),

  check: (input, sessionId, _options) =>
    Effect.gen(function* () {
      const filePath = extractPath(input.tool_input)
      if (!filePath) return null

      const sql = yield* SqlClient.SqlClient

      // Reading a file explicitly puts it in scope.
      const reads = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt
        FROM file_events
        WHERE session_id = ${sessionId}
          AND file_path = ${filePath}
          AND event = 'read'
      `

      if (reads[0]!.cnt > 0) return null

      // Previously edited files are also in scope.
      const priorEdits = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt
        FROM file_events
        WHERE session_id = ${sessionId}
          AND file_path = ${filePath}
          AND event = 'edit'
      `

      if (priorEdits[0]!.cnt > 0) return null

      // Blast radius includes files depending on recently edited files.
      const inBlastRadius = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt
        FROM blast_radius
        WHERE session_id = ${sessionId}
          AND affected_file = ${filePath}
      `

      if (inBlastRadius[0]!.cnt > 0) return null

      return `${filePath} is outside the blast radius of current edits and has not been read this session.`
    }),
}
