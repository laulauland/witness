/**
 * Integration tests for the record command pipeline.
 *
 * Uses real SQLite :memory: DB via Effect layers.
 * Tests the full pipeline: raw JSON → parse → insert → verify DB state.
 */
import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeTestLayer } from "../helpers/db.js"
import { recordPipeline } from "../../src/commands/Record.js"

describe("Record pipeline", () => {
  // ── Tool call recording ───────────────────────────────────────

  it("inserts tool_calls row for Edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        hook: "PostToolUse",
        tool_name: "Edit",
        tool_input: { path: "src/foo.ts", old_text: "a", new_text: "b" },
        tool_output: "File edited",
        tool_exit_code: 0,
      }))

      return yield* sql<{ tool_name: string; tool_input: string }>`
        SELECT tool_name, tool_input FROM tool_calls
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.tool_name).toBe("Edit")
    const input = JSON.parse(result[0]!.tool_input)
    expect(input.path).toBe("src/foo.ts")
  })

  it("inserts tool_calls row for unknown tools (Bash)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "ls -la" },
        tool_output: "file list",
      }))

      return yield* sql<{ tool_name: string }>`
        SELECT tool_name FROM tool_calls
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.tool_name).toBe("Bash")
  })

  it("stores tool_output in tool_calls", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Read",
        tool_input: { path: "src/foo.ts" },
        tool_output: "file contents here",
      }))

      return yield* sql<{ tool_output: string | null }>`
        SELECT tool_output FROM tool_calls
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.tool_output).toBe("file contents here")
  })

  // ── File event extraction ─────────────────────────────────────

  it("inserts file_events row for Edit", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Edit",
        tool_input: { path: "src/auth.ts" },
        tool_output: "File edited",
      }))

      return yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("edit")
    expect(result[0]!.file_path).toBe("src/auth.ts")
  })

  it("inserts file_events row for Read", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Read",
        tool_input: { path: "src/config.ts" },
        tool_output: "contents",
      }))

      return yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("read")
    expect(result[0]!.file_path).toBe("src/config.ts")
  })

  it("inserts file_events row for Write (create)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Write",
        tool_input: { path: "src/new-file.ts", content: "hello" },
      }))

      return yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("create")
    expect(result[0]!.file_path).toBe("src/new-file.ts")
  })

  it("inserts file_events for str_replace_editor", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "str_replace_editor",
        tool_input: { path: "src/utils.ts" },
      }))

      return yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("edit")
    expect(result[0]!.file_path).toBe("src/utils.ts")
  })

  it("inserts file_events for view (read)", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "view",
        tool_input: { path: "src/main.ts" },
      }))

      return yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("read")
    expect(result[0]!.file_path).toBe("src/main.ts")
  })

  // ── No file_events for non-file tools ─────────────────────────

  it("does not insert file_events for Bash", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }))

      const toolCalls = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      const fileEvents = yield* sql<{ event: string }>`SELECT event FROM file_events`

      return { toolCalls, fileEvents }
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.fileEvents).toHaveLength(0)
  })

  // ── Clock / ordering ──────────────────────────────────────────

  it("assigns monotonically increasing t values", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* recordPipeline(JSON.stringify({
        tool_name: "Read",
        tool_input: { path: "src/a.ts" },
      }))

      yield* recordPipeline(JSON.stringify({
        tool_name: "Edit",
        tool_input: { path: "src/a.ts" },
      }))

      const toolCalls = yield* sql<{ t: number; tool_name: string }>`
        SELECT t, tool_name FROM tool_calls ORDER BY t
      `
      const fileEvents = yield* sql<{ t: number; event: string }>`
        SELECT t, event FROM file_events ORDER BY t
      `

      return { toolCalls, fileEvents }
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    // Two tool calls + two file events = 4 ticks
    expect(result.toolCalls).toHaveLength(2)
    expect(result.fileEvents).toHaveLength(2)

    // tool_calls t values: 1 and 3 (2 and 4 are file events)
    expect(result.toolCalls[0]!.t).toBe(1)
    expect(result.toolCalls[1]!.t).toBe(3)

    // file_events t values: 2 and 4
    expect(result.fileEvents[0]!.t).toBe(2)
    expect(result.fileEvents[0]!.event).toBe("read")
    expect(result.fileEvents[1]!.t).toBe(4)
    expect(result.fileEvents[1]!.event).toBe("edit")
  })

  // ── Graceful failure / never crash ────────────────────────────

  it("handles empty string input gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles malformed JSON gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("this is not json {{{ broken")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles JSON without tool_name gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(JSON.stringify({ hook: "PostToolUse", tool_input: {} }))

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles empty JSON object gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("{}")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles null input gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("null")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles array input gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("[1, 2, 3]")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("handles binary garbage gracefully", async () => {
    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline("\x00\x01\x02\xff\xfe")

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  // ── Fixture-based tests ───────────────────────────────────────

  it("processes edit-file.json fixture", async () => {
    const fixture = await Bun.file("fixtures/hook-inputs/edit-file.json").text()

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(fixture)

      const toolCalls = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      const fileEvents = yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
      return { toolCalls, fileEvents }
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]!.tool_name).toBe("Edit")
    expect(result.fileEvents).toHaveLength(1)
    expect(result.fileEvents[0]!.event).toBe("edit")
    expect(result.fileEvents[0]!.file_path).toBe("src/auth.ts")
  })

  it("processes read-file.json fixture", async () => {
    const fixture = await Bun.file("fixtures/hook-inputs/read-file.json").text()

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(fixture)

      const fileEvents = yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
      return fileEvents
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("read")
    expect(result[0]!.file_path).toBe("src/auth.ts")
  })

  it("processes write-file.json fixture", async () => {
    const fixture = await Bun.file("fixtures/hook-inputs/write-file.json").text()

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(fixture)

      const fileEvents = yield* sql<{ event: string; file_path: string }>`
        SELECT event, file_path FROM file_events
      `
      return fileEvents
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.event).toBe("create")
    expect(result[0]!.file_path).toBe("src/config.ts")
  })

  it("processes malformed fixture without crash", async () => {
    const fixture = await Bun.file("fixtures/hook-inputs/malformed.json").text()

    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(fixture)

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  it("processes missing-tool-name fixture without crash", async () => {
    const fixture = await Bun.file("fixtures/hook-inputs/missing-tool-name.json").text()

    await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* recordPipeline(fixture)

      const rows = yield* sql<{ tool_name: string }>`SELECT tool_name FROM tool_calls`
      expect(rows).toHaveLength(0)
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )
  })

  // ── Full pipeline: multi-step scenario ────────────────────────

  it("records a read-then-edit sequence with correct ordering", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      // Agent reads a file
      yield* recordPipeline(JSON.stringify({
        tool_name: "Read",
        tool_input: { path: "src/auth.ts" },
        tool_output: "export const auth = ...",
      }))

      // Agent edits the file
      yield* recordPipeline(JSON.stringify({
        tool_name: "Edit",
        tool_input: { path: "src/auth.ts", old_text: "old", new_text: "new" },
        tool_output: "File edited",
      }))

      // Agent creates a new file
      yield* recordPipeline(JSON.stringify({
        tool_name: "Write",
        tool_input: { path: "src/auth.test.ts", content: "test" },
      }))

      const toolCalls = yield* sql<{ t: number; tool_name: string }>`
        SELECT t, tool_name FROM tool_calls ORDER BY t
      `
      const fileEvents = yield* sql<{ t: number; event: string; file_path: string }>`
        SELECT t, event, file_path FROM file_events ORDER BY t
      `

      return { toolCalls, fileEvents }
    }).pipe(
      Effect.provide(makeTestLayer()),
      Effect.runPromise
    )

    // 3 tool calls
    expect(result.toolCalls).toHaveLength(3)
    expect(result.toolCalls[0]!.tool_name).toBe("Read")
    expect(result.toolCalls[1]!.tool_name).toBe("Edit")
    expect(result.toolCalls[2]!.tool_name).toBe("Write")

    // 3 file events
    expect(result.fileEvents).toHaveLength(3)
    expect(result.fileEvents[0]!.event).toBe("read")
    expect(result.fileEvents[0]!.file_path).toBe("src/auth.ts")
    expect(result.fileEvents[1]!.event).toBe("edit")
    expect(result.fileEvents[1]!.file_path).toBe("src/auth.ts")
    expect(result.fileEvents[2]!.event).toBe("create")
    expect(result.fileEvents[2]!.file_path).toBe("src/auth.test.ts")

    // All t values are monotonically increasing
    const allTs = [...result.toolCalls.map(r => r.t), ...result.fileEvents.map(r => r.t)].sort((a, b) => a - b)
    for (let i = 1; i < allTs.length; i++) {
      expect(allTs[i]!).toBeGreaterThan(allTs[i - 1]!)
    }
  })

  it("record command auto-applies schema and records without prior init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "witness-record-"))
    const dbPath = join(dir, "witness.db")

    try {
      const payload = JSON.stringify({
        tool_name: "Edit",
        tool_input: { path: "src/auto-init.ts" },
      })

      const proc = Bun.spawn(["bun", "run", "src/main.ts", "record"], {
        env: { ...process.env, WITNESS_DB: dbPath },
        stdin: new TextEncoder().encode(payload),
        stdout: "pipe",
        stderr: "pipe",
      })

      const exitCode = await proc.exited
      expect(exitCode).toBe(0)

      const db = new Database(dbPath)
      const toolCallCount = db.query("SELECT COUNT(*) AS count FROM tool_calls").get() as { count: number }
      const fileEvent = db.query("SELECT event, file_path FROM file_events LIMIT 1").get() as {
        event: string
        file_path: string
      }
      db.close()

      expect(toolCallCount.count).toBe(1)
      expect(fileEvent.event).toBe("edit")
      expect(fileEvent.file_path).toBe("src/auto-init.ts")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
