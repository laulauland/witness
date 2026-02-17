/**
 * Monotonic logical clock, session-scoped.
 *
 * Uses the `clock` table: one row per session_id with current_t.
 * tick() atomically increments and returns the new value.
 */
import { SqlClient } from "@effect/sql"
import { type SqlError } from "@effect/sql/SqlError"
import { Effect } from "effect"

/**
 * Atomically increment the clock for a session and return the new t value.
 * Creates the clock row if it doesn't exist (first tick = 1).
 */
export const tick = (sessionId: string): Effect.Effect<number, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // Upsert: insert if missing, increment if present
    yield* sql`
      INSERT INTO clock (session_id, current_t)
      VALUES (${sessionId}, 1)
      ON CONFLICT(session_id) DO UPDATE SET current_t = current_t + 1
    `

    // Read the current value
    const rows = yield* sql<{ current_t: number }>`
      SELECT current_t FROM clock WHERE session_id = ${sessionId}
    `

    return rows[0]!.current_t
  })

/**
 * Get the current clock value for a session without incrementing.
 * Returns 0 if no clock row exists.
 */
export const currentTick = (sessionId: string): Effect.Effect<number, SqlError, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const rows = yield* sql<{ current_t: number }>`
      SELECT current_t FROM clock WHERE session_id = ${sessionId}
    `

    return rows.length > 0 ? rows[0]!.current_t : 0
  })
