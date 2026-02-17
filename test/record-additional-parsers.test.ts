/**
 * Integration tests: Phase 8 additional parsers through record pipeline.
 */
import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Effect } from "effect"
import { recordPipeline } from "../src/commands/Record.js"
import { makeTestLayer } from "./helpers/db.js"

const fixturesDir = resolve(import.meta.dir, "../fixtures/tool-outputs")

const runBashRecord = (command: string, output: string) =>
  recordPipeline(
    JSON.stringify({
      hook: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command },
      tool_output: output,
      tool_exit_code: 0,
    })
  )

describe("Record pipeline: additional parsers", () => {
  test("records go test output into test_results", async () => {
    const output = readFileSync(resolve(fixturesDir, "go-test-fail.txt"), "utf-8")

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("go test -v ./...", output)

      const tests = yield* sql<{ test_name: string; outcome: string }>`
        SELECT test_name, outcome FROM test_results ORDER BY test_name
      `
      const toolCalls = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt FROM tool_calls
      `

      return { tests, toolCalls }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.tests.length).toBe(9)
    expect(result.tests.find((r) => r.test_name === "TestHandleRequest")?.outcome).toBe("fail")
    expect(result.tests.find((r) => r.test_name === "TestParseConfig")?.outcome).toBe("pass")
    expect(result.toolCalls[0]!.cnt).toBe(1)
  })

  test("records cargo test output into test_results", async () => {
    const output = readFileSync(resolve(fixturesDir, "cargo-test-fail.txt"), "utf-8")

    const rows = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("cargo test", output)

      return yield* sql<{ test_name: string; outcome: string }>`
        SELECT test_name, outcome FROM test_results ORDER BY test_name
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(rows.length).toBe(6)
    expect(rows.filter((r) => r.outcome === "fail").length).toBe(2)
    expect(rows.some((r) => r.test_name === "math::tests::test_multiply")).toBe(true)
  })

  test("records eslint JSON output into lint_results", async () => {
    const output = readFileSync(resolve(fixturesDir, "eslint-json.json"), "utf-8")

    const rows = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("eslint src/ -f json", output)

      return yield* sql<{ file_path: string; line: number | null; rule: string; severity: string }>`
        SELECT file_path, line, rule, severity
        FROM lint_results
        ORDER BY file_path, line
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(rows.length).toBe(4)
    expect(rows.some((r) => r.rule === "no-console" && r.severity === "warning")).toBe(true)
    expect(rows.some((r) => r.rule === "@typescript-eslint/no-unused-vars" && r.severity === "error")).toBe(true)
  })

  test("records ruff JSON output into lint_results", async () => {
    const output = readFileSync(resolve(fixturesDir, "ruff-json.json"), "utf-8")

    const rows = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("ruff check src/ --output-format json", output)

      return yield* sql<{ file_path: string; rule: string; severity: string }>`
        SELECT file_path, rule, severity FROM lint_results ORDER BY file_path, rule
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(rows.length).toBe(3)
    expect(rows.some((r) => r.rule === "F401" && r.severity === "error")).toBe(true)
    expect(rows.some((r) => r.rule === "W291" && r.severity === "warning")).toBe(true)
  })

  test("records tsc output into type_errors", async () => {
    const output = readFileSync(resolve(fixturesDir, "tsc-errors.txt"), "utf-8")

    const rows = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("bunx tsc --noEmit", output)

      return yield* sql<{ file_path: string; line: number | null; message: string }>`
        SELECT file_path, line, message FROM type_errors ORDER BY file_path, line
      `
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(rows.length).toBe(5)
    expect(rows.some((r) => r.file_path === "src/auth.ts" && r.message.includes("TS2345"))).toBe(true)
    expect(rows.some((r) => r.file_path === "src/index.ts" && r.message.includes("TS2322"))).toBe(true)
  })

  test("records mypy/pyright output into type_errors", async () => {
    const mypyOutput = readFileSync(resolve(fixturesDir, "mypy-errors.txt"), "utf-8")
    const pyrightOutput = readFileSync(resolve(fixturesDir, "pyright-errors.txt"), "utf-8")

    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* runBashRecord("mypy src/", mypyOutput)
      yield* runBashRecord("pyright", pyrightOutput)

      const rows = yield* sql<{ file_path: string; line: number | null; message: string }>`
        SELECT file_path, line, message FROM type_errors ORDER BY file_path, line
      `
      const toolCalls = yield* sql<{ cnt: number }>`
        SELECT COUNT(*) AS cnt FROM tool_calls
      `

      return { rows, toolCalls }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.rows.length).toBe(7)
    expect(result.rows.some((r) => r.message.includes("Incompatible types in assignment"))).toBe(true)
    expect(result.rows.some((r) => r.message.includes("could not be resolved"))).toBe(true)
    expect(result.rows.some((r) => r.message.includes("See class definition"))).toBe(false)
    expect(result.toolCalls[0]!.cnt).toBe(2)
  })

  test("malformed outputs never crash and do not insert structured parser facts", async () => {
    const result = await Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* runBashRecord("go test ./...", "totally not go output")
      yield* runBashRecord("cargo test", "{\"broken\":true}")
      yield* runBashRecord("eslint src/", "not eslint")
      yield* runBashRecord("ruff check src/", "not ruff")
      yield* runBashRecord("tsc --noEmit", "Found 0 errors.")
      yield* runBashRecord("mypy src/", "Success: no issues found in 1 file")

      const toolCalls = yield* sql<{ cnt: number }>`SELECT COUNT(*) AS cnt FROM tool_calls`
      const testResults = yield* sql<{ cnt: number }>`SELECT COUNT(*) AS cnt FROM test_results`
      const lintResults = yield* sql<{ cnt: number }>`SELECT COUNT(*) AS cnt FROM lint_results`
      const typeErrors = yield* sql<{ cnt: number }>`SELECT COUNT(*) AS cnt FROM type_errors`

      return { toolCalls, testResults, lintResults, typeErrors }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.toolCalls[0]!.cnt).toBe(6)
    expect(result.testResults[0]!.cnt).toBe(0)
    expect(result.lintResults[0]!.cnt).toBe(0)
    expect(result.typeErrors[0]!.cnt).toBe(0)
  })
})
