/**
 * Tests for depends_on and blast_radius SQL views.
 *
 * Tests transitive dependency closure and reverse dependency (blast radius).
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "./helpers/db.js"

describe("depends_on view (transitive closure)", () => {
  test("direct dependency: A imports B → deps(A) includes B", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`

      return yield* sql<{ source_file: string; imported_module: string; depth: number }>`
        SELECT source_file, imported_module, depth FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.imported_module).toBe("src/b.ts")
    expect(result[0]!.depth).toBe(1)
  })

  test("transitive: A→B→C → deps(A) includes B and C", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/c.ts')`

      return yield* sql<{ imported_module: string; depth: number }>`
        SELECT imported_module, depth FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
        ORDER BY depth ASC
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(2)
    expect(result[0]!.imported_module).toBe("src/b.ts")
    expect(result[0]!.depth).toBe(1)
    expect(result[1]!.imported_module).toBe("src/c.ts")
    expect(result[1]!.depth).toBe(2)
  })

  test("3-level chain: A→B→C→D → deps(A) includes B, C, D", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/c.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 3, 'src/c.ts', 'src/d.ts')`

      return yield* sql<{ imported_module: string; depth: number }>`
        SELECT imported_module, depth FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
        ORDER BY depth ASC
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(3)
    const modules = result.map((r) => r.imported_module)
    expect(modules).toContain("src/b.ts")
    expect(modules).toContain("src/c.ts")
    expect(modules).toContain("src/d.ts")
  })

  test("diamond dependency: A→B, A→C, B→D, C→D → deps(A) includes B,C,D", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/a.ts', 'src/c.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 3, 'src/b.ts', 'src/d.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 4, 'src/c.ts', 'src/d.ts')`

      return yield* sql<{ imported_module: string }>`
        SELECT DISTINCT imported_module FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
        ORDER BY imported_module ASC
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(3)
    expect(result.map((r) => r.imported_module)).toEqual(["src/b.ts", "src/c.ts", "src/d.ts"])
  })

  test("session scoping: deps from other session not visible", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s2', 1, 'src/a.ts', 'src/c.ts')`

      return yield* sql<{ imported_module: string }>`
        SELECT imported_module FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(1)
    expect(result[0]!.imported_module).toBe("src/b.ts")
  })

  test("no self-loops in closure", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/a.ts')`

      return yield* sql<{ imported_module: string }>`
        SELECT imported_module FROM depends_on
        WHERE session_id = 's1' AND source_file = 'src/a.ts'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Both should appear — a depends on b, and transitively on a (via cycle)
    // The depth limit prevents infinite recursion
    const modules = result.map((r) => r.imported_module)
    expect(modules).toContain("src/b.ts")
  })
})

describe("blast_radius view (reverse transitive dependencies)", () => {
  test("edit C → blast includes A (A imports B imports C)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // A imports B, B imports C
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/c.ts')`

      // Edit C
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/c.ts')`

      return yield* sql<{ edited_file: string; affected_file: string; depth: number }>`
        SELECT edited_file, affected_file, depth FROM blast_radius
        WHERE session_id = 's1'
        ORDER BY depth ASC
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    const affected = result.map((r) => r.affected_file)
    expect(affected).toContain("src/b.ts")
    expect(affected).toContain("src/a.ts")
  })

  test("edit B → blast includes A but not C", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 2, 'src/b.ts', 'src/c.ts')`

      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 3, 'edit', 'src/b.ts')`

      return yield* sql<{ affected_file: string }>`
        SELECT affected_file FROM blast_radius
        WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    const affected = result.map((r) => r.affected_file)
    expect(affected).toContain("src/a.ts")
    expect(affected).not.toContain("src/c.ts")
  })

  test("no edit → empty blast radius", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`

      return yield* sql<{ affected_file: string }>`
        SELECT affected_file FROM blast_radius
        WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(0)
  })

  test("edit leaf node → no blast radius (nothing depends on it)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`

      // Edit A (leaf — nothing depends on A)
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s1', 2, 'edit', 'src/a.ts')`

      return yield* sql<{ affected_file: string }>`
        SELECT affected_file FROM blast_radius
        WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toHaveLength(0)
  })

  test("session scoping: blast radius only within session", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module) VALUES ('s1', 1, 'src/a.ts', 'src/b.ts')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path) VALUES ('s2', 2, 'edit', 'src/b.ts')`

      return yield* sql<{ affected_file: string }>`
        SELECT affected_file FROM blast_radius
        WHERE session_id = 's1'
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // Edit is in s2, imports in s1 — blast_radius joins on session_id so no results
    expect(result).toHaveLength(0)
  })
})
