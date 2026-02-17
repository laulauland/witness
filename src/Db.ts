/**
 * Database layer configuration.
 *
 * Provides SqliteClient via @effect/sql-sqlite-bun.
 * DB path resolved from:
 *   1. WITNESS_DB env var
 *   2. Default: .witness/witness.db
 */
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Config } from "effect"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

/** Default DB path relative to project root */
export const DEFAULT_DB_PATH = ".witness/witness.db"

/**
 * SqliteClient layer configured from WITNESS_DB env var or default path.
 * Ensures parent directory exists before opening.
 * Provides both SqliteClient and the generic SqlClient tags.
 */
export const DbLive = SqliteClient.layerConfig(
  Config.map(
    Config.string("WITNESS_DB").pipe(
      Config.withDefault(DEFAULT_DB_PATH)
    ),
    (filename): SqliteClient.SqliteClientConfig => {
      const resolved = resolve(filename)
      try {
        mkdirSync(dirname(resolved), { recursive: true })
      } catch {
        // best-effort
      }
      return {
        filename: resolved,
        disableWAL: false,
      }
    }
  )
)

/**
 * In-memory DB layer for testing.
 */
export const DbTest = SqliteClient.layer({ filename: ":memory:" })

/**
 * Layer from an explicit path (for CLI --db flag or init command).
 */
export const DbFromPath = (filename: string) =>
  SqliteClient.layer({ filename, disableWAL: false })
