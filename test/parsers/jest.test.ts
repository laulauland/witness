/**
 * Tests for the jest/vitest parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseJestOutput } from "../../src/parsers/jest.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "bun test" },
  tool_output: output,
})

describe("Jest parser", () => {
  // ── JSON parsing ──────────────────────────────────────────

  test("parses jest JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "jest-json.json"), "utf-8")
    const facts = parseJestOutput(makeInput(json))

    expect(facts.length).toBe(6)

    // All should be TestResult
    for (const f of facts) {
      expect(f._tag).toBe("TestResult")
    }

    // Check specific results
    const results = facts.filter((f) => f._tag === "TestResult") as any[]

    const pass1 = results.find((r: any) => r.test_name === "Auth should validate token")
    expect(pass1).toBeDefined()
    expect(pass1.outcome).toBe("pass")

    const fail1 = results.find((r: any) => r.test_name === "Auth should refresh expired token")
    expect(fail1).toBeDefined()
    expect(fail1.outcome).toBe("fail")
    expect(fail1.message).toContain("Token refresh failed")

    const fail2 = results.find((r: any) => r.test_name === "Auth should handle invalid token")
    expect(fail2).toBeDefined()
    expect(fail2.outcome).toBe("fail")
    expect(fail2.message).toContain("Cannot read property")

    const pending = results.find((r: any) => r.test_name.includes("should support new format"))
    expect(pending).toBeDefined()
    expect(pending.outcome).toBe("skip")

    const passUtils = results.filter((r: any) => r.outcome === "pass")
    expect(passUtils.length).toBe(3)
  })

  // ── Text parsing ──────────────────────────────────────────

  test("parses jest text output with ✓/✗ markers", () => {
    const text = readFileSync(resolve(fixturesDir, "jest-text.txt"), "utf-8")
    const facts = parseJestOutput(makeInput(text))

    expect(facts.length).toBeGreaterThanOrEqual(5)

    const results = facts.filter((f) => f._tag === "TestResult") as any[]

    // Check passing tests
    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBeGreaterThanOrEqual(3)

    // Check failing tests
    const fails = results.filter((r: any) => r.outcome === "fail")
    expect(fails.length).toBeGreaterThanOrEqual(2)

    const refreshFail = fails.find((r: any) => r.test_name.includes("refresh expired token"))
    expect(refreshFail).toBeDefined()
  })

  test("parses all-passing jest text output", () => {
    const text = readFileSync(resolve(fixturesDir, "jest-text-pass.txt"), "utf-8")
    const facts = parseJestOutput(makeInput(text))

    expect(facts.length).toBe(4)

    const results = facts as any[]
    for (const r of results) {
      expect(r.outcome).toBe("pass")
    }
  })

  test("parses vitest text output", () => {
    const text = readFileSync(resolve(fixturesDir, "vitest-text.txt"), "utf-8")
    const facts = parseJestOutput(makeInput(text))

    expect(facts.length).toBeGreaterThanOrEqual(4)

    const results = facts as any[]
    const passes = results.filter((r: any) => r.outcome === "pass")
    const fails = results.filter((r: any) => r.outcome === "fail")

    expect(passes.length).toBeGreaterThanOrEqual(2)
    expect(fails.length).toBeGreaterThanOrEqual(2)
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    const facts = parseJestOutput(makeInput(""))
    expect(facts).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    const facts = parseJestOutput(makeInput("this is not test output at all"))
    expect(facts).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    const facts = parseJestOutput({
      tool_name: "Bash",
      tool_input: { command: "jest" },
    })
    expect(facts).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    const facts = parseJestOutput(makeInput('{"broken": true'))
    expect(facts).toEqual([])
  })

  test("returns empty array on JSON with no testResults", () => {
    const facts = parseJestOutput(makeInput('{"unrelated": "data"}'))
    expect(facts).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    const facts = parseJestOutput(makeInput(binary))
    expect(facts).toEqual([])
  })
})
