/**
 * Test helper: provides a fresh in-memory SQLite DB with schema applied.
 */
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { Effect, Layer } from "effect"
import { applySchema } from "../../src/Schema.js"

/**
 * Create a fresh test layer with in-memory DB + schema.
 * Each call creates a new isolated database.
 */
export const makeTestLayer = () =>
  SqliteClient.layer({ filename: ":memory:" }).pipe(
    Layer.tap((ctx) =>
      applySchema.pipe(Effect.provide(Layer.succeedContext(ctx)))
    )
  )
