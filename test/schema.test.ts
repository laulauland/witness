import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "./helpers/db.js"

describe("Schema", () => {
  test("creates all tables", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const tables = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `
      return tables.map((r) => r.name)
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toContain("clock")
    expect(result).toContain("tool_calls")
    expect(result).toContain("hook_events")
    expect(result).toContain("file_events")
    expect(result).toContain("test_results")
    expect(result).toContain("lint_results")
    expect(result).toContain("type_errors")
    expect(result).toContain("imports")
  })

  test("creates all views", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const views = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'view'
        ORDER BY name
      `
      return views.map((r) => r.name)
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toContain("current_test_state")
    expect(result).toContain("failing_tests")
    expect(result).toContain("regressions")
    expect(result).toContain("thrashing")
    expect(result).toContain("edits_since_last_test")
    expect(result).toContain("edited_but_unread")
    expect(result).toContain("depends_on")
    expect(result).toContain("blast_radius")
    expect(result).toContain("error_clusters")
    expect(result).toContain("likely_fixes")
    expect(result).toContain("untested_edits")
  })

  test("creates all indexes", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const indexes = yield* sql<{ name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_%'
        ORDER BY name
      `
      return indexes.map((r) => r.name)
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toContain("idx_tool_calls_session")
    expect(result).toContain("idx_hook_events_session")
    expect(result).toContain("idx_file_events_session")
    expect(result).toContain("idx_file_events_path")
    expect(result).toContain("idx_test_results_session")
    expect(result).toContain("idx_test_results_name")
    expect(result).toContain("idx_lint_results_session")
    expect(result).toContain("idx_lint_results_path")
    expect(result).toContain("idx_type_errors_session")
    expect(result).toContain("idx_type_errors_path")
    expect(result).toContain("idx_imports_session")
    expect(result).toContain("idx_imports_source")
  })

  test("schema is idempotent — applying twice does not error", async () => {
    const { applySchema } = await import("../src/Schema.js")

    const result = await Effect.gen(function* () {
      // Schema is already applied via makeTestLayer.
      // Apply it again — should not throw.
      yield* applySchema
      return "ok"
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe("ok")
  })

  test("tables have correct columns", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      const toolCallCols = yield* sql<{ name: string }>`PRAGMA table_info(tool_calls)`
      const hookEventCols = yield* sql<{ name: string }>`PRAGMA table_info(hook_events)`
      const fileEventCols = yield* sql<{ name: string }>`PRAGMA table_info(file_events)`
      const testResultCols = yield* sql<{ name: string }>`PRAGMA table_info(test_results)`
      const lintResultCols = yield* sql<{ name: string }>`PRAGMA table_info(lint_results)`
      const typeErrorCols = yield* sql<{ name: string }>`PRAGMA table_info(type_errors)`
      const importCols = yield* sql<{ name: string }>`PRAGMA table_info(imports)`
      const clockCols = yield* sql<{ name: string }>`PRAGMA table_info(clock)`

      return {
        tool_calls: toolCallCols.map((r) => r.name),
        hook_events: hookEventCols.map((r) => r.name),
        file_events: fileEventCols.map((r) => r.name),
        test_results: testResultCols.map((r) => r.name),
        lint_results: lintResultCols.map((r) => r.name),
        type_errors: typeErrorCols.map((r) => r.name),
        imports: importCols.map((r) => r.name),
        clock: clockCols.map((r) => r.name),
      }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // tool_calls
    expect(result.tool_calls).toContain("session_id")
    expect(result.tool_calls).toContain("t")
    expect(result.tool_calls).toContain("ts")
    expect(result.tool_calls).toContain("tool_name")
    expect(result.tool_calls).toContain("tool_input")
    expect(result.tool_calls).toContain("tool_output")

    // hook_events
    expect(result.hook_events).toContain("session_id")
    expect(result.hook_events).toContain("t")
    expect(result.hook_events).toContain("ts")
    expect(result.hook_events).toContain("event")
    expect(result.hook_events).toContain("tool_name")
    expect(result.hook_events).toContain("action")
    expect(result.hook_events).toContain("message")
    expect(result.hook_events).toContain("payload")
    expect(result.hook_events).toContain("result")

    // file_events
    expect(result.file_events).toContain("session_id")
    expect(result.file_events).toContain("t")
    expect(result.file_events).toContain("ts")
    expect(result.file_events).toContain("event")
    expect(result.file_events).toContain("file_path")

    // test_results
    expect(result.test_results).toContain("session_id")
    expect(result.test_results).toContain("t")
    expect(result.test_results).toContain("ts")
    expect(result.test_results).toContain("test_name")
    expect(result.test_results).toContain("outcome")
    expect(result.test_results).toContain("message")

    // lint_results
    expect(result.lint_results).toContain("session_id")
    expect(result.lint_results).toContain("t")
    expect(result.lint_results).toContain("ts")
    expect(result.lint_results).toContain("file_path")
    expect(result.lint_results).toContain("line")
    expect(result.lint_results).toContain("rule")
    expect(result.lint_results).toContain("severity")

    // type_errors
    expect(result.type_errors).toContain("session_id")
    expect(result.type_errors).toContain("t")
    expect(result.type_errors).toContain("ts")
    expect(result.type_errors).toContain("file_path")
    expect(result.type_errors).toContain("line")
    expect(result.type_errors).toContain("message")

    // imports
    expect(result.imports).toContain("session_id")
    expect(result.imports).toContain("t")
    expect(result.imports).toContain("ts")
    expect(result.imports).toContain("source_file")
    expect(result.imports).toContain("imported_module")

    // clock
    expect(result.clock).toContain("session_id")
    expect(result.clock).toContain("current_t")
  })

  test("can insert and query from all tables", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Insert into each table
      yield* sql`INSERT INTO tool_calls (session_id, t, tool_name, tool_input)
                  VALUES ('s1', 1, 'Edit', '{"path":"a.ts"}')`
      yield* sql`INSERT INTO hook_events (session_id, t, event, tool_name, action)
                  VALUES ('s1', 1, 'record', 'Edit', 'recorded')`
      yield* sql`INSERT INTO file_events (session_id, t, event, file_path)
                  VALUES ('s1', 1, 'edit', 'a.ts')`
      yield* sql`INSERT INTO test_results (session_id, t, test_name, outcome)
                  VALUES ('s1', 1, 'test_x', 'pass')`
      yield* sql`INSERT INTO lint_results (session_id, t, file_path, rule, severity)
                  VALUES ('s1', 1, 'a.ts', 'no-unused-vars', 'warning')`
      yield* sql`INSERT INTO type_errors (session_id, t, file_path, message)
                  VALUES ('s1', 1, 'a.ts', 'Type error')`
      yield* sql`INSERT INTO imports (session_id, t, source_file, imported_module)
                  VALUES ('s1', 1, 'a.ts', 'b.ts')`

      // Query each
      const tc = yield* sql`SELECT * FROM tool_calls`
      expect(tc).toHaveLength(1)
      const he = yield* sql`SELECT * FROM hook_events`
      expect(he).toHaveLength(1)
      const fe = yield* sql`SELECT * FROM file_events`
      expect(fe).toHaveLength(1)
      const tr = yield* sql`SELECT * FROM test_results`
      expect(tr).toHaveLength(1)
      const lr = yield* sql`SELECT * FROM lint_results`
      expect(lr).toHaveLength(1)
      const te = yield* sql`SELECT * FROM type_errors`
      expect(te).toHaveLength(1)
      const im = yield* sql`SELECT * FROM imports`
      expect(im).toHaveLength(1)
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)
  })
})
