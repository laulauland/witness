import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

export type HookEventKind = "lint" | "record"

export interface HookEventRow {
  readonly session_id: string
  readonly t: number
  readonly event: HookEventKind
  readonly tool_name: string | null
  readonly action: string
  readonly message: string | null
  readonly payload: string | null
  readonly result: string | null
}

export const insertHookEvent = (
  sql: SqlClient.SqlClient,
  row: HookEventRow
): Effect.Effect<unknown, unknown, never> =>
  sql`INSERT INTO hook_events (session_id, t, event, tool_name, action, message, payload, result)
      VALUES (
        ${row.session_id},
        ${row.t},
        ${row.event},
        ${row.tool_name},
        ${row.action},
        ${row.message},
        ${row.payload},
        ${row.result}
      )`
