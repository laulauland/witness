/**
 * Integration test: recording test results through the record pipeline.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { makeTestLayer } from "./helpers/db.js"
import { recordPipeline } from "../src/commands/Record.js"

describe("Record pipeline: test results", () => {
  test("records jest JSON output into test_results table", async () => {
    const input = JSON.stringify({
      hook: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "bun test" },
      tool_output: JSON.stringify({
        numFailedTests: 1,
        numPassedTests: 2,
        testResults: [
          {
            name: "auth.test.ts",
            assertionResults: [
              { fullName: "should login", status: "passed" },
              { fullName: "should logout", status: "passed" },
              { fullName: "should refresh", status: "failed", failureMessages: ["Error: timeout"] },
            ],
          },
        ],
      }),
    })

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      // Seed the clock table
      yield* sql`INSERT INTO clock (session_id, current_t) VALUES ('default', 0)`
      yield* recordPipeline(input)

      return yield* sql<{ test_name: string; outcome: string; message: string | null }>`
        SELECT test_name, outcome, message FROM test_results ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.length).toBe(3)
    expect(result.find((r) => r.test_name === "should login")?.outcome).toBe("pass")
    expect(result.find((r) => r.test_name === "should logout")?.outcome).toBe("pass")
    const failResult = result.find((r) => r.test_name === "should refresh")
    expect(failResult?.outcome).toBe("fail")
    expect(failResult?.message).toContain("timeout")
  })

  test("records pytest text output into test_results table", async () => {
    const input = JSON.stringify({
      hook: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "pytest tests/" },
      tool_output: [
        "============================= test session starts ==============================",
        "tests/test_auth.py::test_login PASSED",
        "tests/test_auth.py::test_refresh FAILED",
        "========================= 1 failed, 1 passed in 0.5s =========================",
      ].join("\n"),
    })

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO clock (session_id, current_t) VALUES ('default', 0)`
      yield* recordPipeline(input)

      return yield* sql<{ test_name: string; outcome: string }>`
        SELECT test_name, outcome FROM test_results ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.length).toBe(2)
    expect(result.find((r) => r.test_name.includes("test_login"))?.outcome).toBe("pass")
    expect(result.find((r) => r.test_name.includes("test_refresh"))?.outcome).toBe("fail")
  })

  test("exits 0 / no crash on non-test Bash output", async () => {
    const input = JSON.stringify({
      hook: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      tool_output: "total 64\ndrwxr-xr-x  10 user  staff  320 Feb 17 01:00 .",
    })

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO clock (session_id, current_t) VALUES ('default', 0)`
      yield* recordPipeline(input)

      return yield* sql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM test_results`
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    // No test results inserted for a non-test command
    expect(result[0]!.cnt).toBe(0)
  })

  test("still records tool_calls row for test commands", async () => {
    const input = JSON.stringify({
      hook: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "bun test" },
      tool_output: "PASS src/test.ts\nTests: 1 passed",
    })

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO clock (session_id, current_t) VALUES ('default', 0)`
      yield* recordPipeline(input)

      return yield* sql<{ cnt: number }>`SELECT COUNT(*) as cnt FROM tool_calls`
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result[0]!.cnt).toBe(1)
  })
})
