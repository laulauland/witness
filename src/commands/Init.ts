/**
 * `witness init` — create the DB directory and apply the schema.
 *
 * Idempotent: running twice is safe (CREATE TABLE IF NOT EXISTS).
 */
import { Command } from "@effect/cli"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Console, Effect } from "effect"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { DEFAULT_DB_PATH } from "../Db.js"
import { applySchema } from "../Schema.js"

export const InitCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const dbPath = process.env.WITNESS_DB ?? DEFAULT_DB_PATH
    const resolved = resolve(dbPath)

    // Ensure parent directory exists
    const dir = dirname(resolved)
    mkdirSync(dir, { recursive: true })

    // Create DB and apply schema
    yield* applySchema.pipe(
      Effect.provide(
        SqliteClient.layer({ filename: resolved, disableWAL: false })
      )
    )

    yield* Console.log(`witness: initialized database at ${resolved}`)
  })
).pipe(Command.withDescription("Create the witness database and schema"))
