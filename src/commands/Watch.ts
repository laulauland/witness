/**
 * `witness watch` — tail lint/record hook events as they arrive.
 *
 * Default output is human-readable. Use --format json for NDJSON.
 */
import { Command, Options } from "@effect/cli"
import { SqlClient } from "@effect/sql"
import { Console, Effect, Option } from "effect"
import { DbLive } from "../Db.js"
import { applySchema } from "../Schema.js"

const DEFAULT_SESSION_ID = "default"

type WatchFormat = "human" | "json"

type HookEventRow = {
  session_id: string
  t: number
  ts: string
  event: string
  tool_name: string | null
  action: string
  message: string | null
  payload: string | null
  result: string | null
}

const formatOption = Options.choice("format", ["human", "json"] as const).pipe(
  Options.withDescription("Output format: human (default) or json (NDJSON)"),
  Options.optional
)

const pollMsOption = Options.integer("poll-ms").pipe(
  Options.withDescription("Polling interval in milliseconds (default: 500)"),
  Options.optional
)

const getSessionId = (): string => process.env.WITNESS_SESSION ?? DEFAULT_SESSION_ID

const formatHuman = (row: HookEventRow): string => {
  const tool = row.tool_name ?? "-"
  const msg = row.message ? ` — ${row.message}` : ""
  return `[${row.ts}] t=${row.t} ${row.event}:${row.action} tool=${tool}${msg}`
}

export const WatchCommand = Command.make(
  "watch",
  {
    format: formatOption,
    pollMs: pollMsOption,
  },
  ({ format, pollMs }) =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        yield* applySchema

        const sql = yield* SqlClient.SqlClient
        const outputFormat: WatchFormat = Option.getOrElse(format, () => "human")
        const pollInterval = Math.max(50, Option.getOrElse(pollMs, () => 500))
        const sessionId = getSessionId()

        // Start tailing from current head (tail -f behavior).
        const headRows = yield* sql<{ max_t: number | null }>`
          SELECT MAX(t) AS max_t FROM hook_events
          WHERE session_id = ${sessionId}
        `

        let lastT = headRows[0]?.max_t ?? 0

        if (outputFormat === "human") {
          yield* Console.log(
            `Watching witness hook events for session '${sessionId}' from t>${lastT} (poll ${pollInterval}ms)`
          )
        }

        while (true) {
          const rows = yield* sql<HookEventRow>`
            SELECT session_id, t, ts, event, tool_name, action, message, payload, result
            FROM hook_events
            WHERE session_id = ${sessionId}
              AND t > ${lastT}
            ORDER BY t ASC
          `

          for (const row of rows) {
            lastT = row.t
            if (outputFormat === "json") {
              yield* Console.log(JSON.stringify(row))
            } else {
              yield* Console.log(formatHuman(row))
            }
          }

          yield* Effect.sleep(pollInterval)
        }
      }).pipe(Effect.provide(DbLive))
    }).pipe(
      Effect.catchAll((error) =>
        Console.error(`witness watch: error: ${String(error)}`)
      ),
      Effect.catchAllDefect((defect) =>
        Console.error(`witness watch: defect: ${String(defect)}`)
      )
    )
).pipe(
  Command.withDescription("Watch incoming lint/record hook events in real time")
)

