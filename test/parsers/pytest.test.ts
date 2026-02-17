/**
 * Tests for the pytest parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parsePytestOutput } from "../../src/parsers/pytest.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "pytest" },
  tool_output: output,
})

describe("Pytest parser", () => {
  // ── JSON parsing ──────────────────────────────────────────

  test("parses pytest JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "pytest-json.json"), "utf-8")
    const facts = parsePytestOutput(makeInput(json))

    expect(facts.length).toBe(5)

    const results = facts as any[]

    const pass1 = results.find((r: any) => r.test_name === "tests/test_auth.py::test_login")
    expect(pass1).toBeDefined()
    expect(pass1.outcome).toBe("pass")

    const fail1 = results.find((r: any) => r.test_name === "tests/test_auth.py::test_refresh_token")
    expect(fail1).toBeDefined()
    expect(fail1.outcome).toBe("fail")
    expect(fail1.message).toContain("Token refresh returned None")

    const fail2 = results.find((r: any) => r.test_name === "tests/test_auth.py::test_invalid_token")
    expect(fail2).toBeDefined()
    expect(fail2.outcome).toBe("fail")
    expect(fail2.message).toContain("has no attribute")

    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBe(3)
  })

  // ── Text parsing ──────────────────────────────────────────

  test("parses pytest text output with PASSED/FAILED", () => {
    const text = readFileSync(resolve(fixturesDir, "pytest-text.txt"), "utf-8")
    const facts = parsePytestOutput(makeInput(text))

    expect(facts.length).toBe(5)

    const results = facts as any[]

    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBe(3)

    const fails = results.filter((r: any) => r.outcome === "fail")
    expect(fails.length).toBe(2)

    const refreshFail = fails.find((r: any) => r.test_name.includes("test_refresh_token"))
    expect(refreshFail).toBeDefined()
    expect(refreshFail.message).toContain("Token refresh returned None")
  })

  test("parses all-passing pytest text output", () => {
    const text = readFileSync(resolve(fixturesDir, "pytest-text-pass.txt"), "utf-8")
    const facts = parsePytestOutput(makeInput(text))

    expect(facts.length).toBe(3)

    const results = facts as any[]
    for (const r of results) {
      expect(r.outcome).toBe("pass")
    }
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    const facts = parsePytestOutput(makeInput(""))
    expect(facts).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    const facts = parsePytestOutput(makeInput("this is not test output"))
    expect(facts).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    const facts = parsePytestOutput({
      tool_name: "Bash",
      tool_input: { command: "pytest" },
    })
    expect(facts).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    const facts = parsePytestOutput(makeInput('{"broken": true'))
    expect(facts).toEqual([])
  })

  test("returns empty array on JSON with no tests array", () => {
    const facts = parsePytestOutput(makeInput('{"summary": {"passed": 1}}'))
    expect(facts).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    const facts = parsePytestOutput(makeInput(binary))
    expect(facts).toEqual([])
  })
})
