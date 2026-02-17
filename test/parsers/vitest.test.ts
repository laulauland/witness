/**
 * Tests for the vitest parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseVitestOutput } from "../../src/parsers/vitest.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "vitest run" },
  tool_output: output,
})

describe("Vitest parser", () => {
  // ── JSON parsing ──────────────────────────────────────────

  test("parses vitest JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "vitest-json.json"), "utf-8")
    const facts = parseVitestOutput(makeInput(json))

    expect(facts.length).toBe(8)
    for (const f of facts) {
      expect(f._tag).toBe("TestResult")
    }

    const results = facts as any[]

    const pass1 = results.find((r: any) => r.test_name === "formatDate should format ISO dates")
    expect(pass1).toBeDefined()
    expect(pass1.outcome).toBe("pass")

    const pass2 = results.find((r: any) => r.test_name === "Auth should validate token")
    expect(pass2).toBeDefined()
    expect(pass2.outcome).toBe("pass")

    const fail1 = results.find((r: any) => r.test_name === "Auth should refresh expired token")
    expect(fail1).toBeDefined()
    expect(fail1.outcome).toBe("fail")
    expect(fail1.message).toContain("expected 200, got 401")

    const fail2 = results.find((r: any) => r.test_name === "Auth should handle token revocation")
    expect(fail2).toBeDefined()
    expect(fail2.outcome).toBe("fail")
    expect(fail2.message).toContain("Cannot read properties")

    const skipped = results.find((r: any) => r.test_name === "Auth should support new format")
    expect(skipped).toBeDefined()
    expect(skipped.outcome).toBe("skip")

    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBe(5)
  })

  // ── Text parsing ──────────────────────────────────────────

  test("parses vitest text output with ✓/✗ markers", () => {
    const text = readFileSync(resolve(fixturesDir, "vitest-text.txt"), "utf-8")
    const facts = parseVitestOutput(makeInput(text))

    expect(facts.length).toBeGreaterThanOrEqual(4)

    const results = facts as any[]
    const passes = results.filter((r: any) => r.outcome === "pass")
    const fails = results.filter((r: any) => r.outcome === "fail")

    expect(passes.length).toBeGreaterThanOrEqual(2)
    expect(fails.length).toBeGreaterThanOrEqual(2)

    const refreshFail = fails.find((r: any) => r.test_name.includes("refresh expired token"))
    expect(refreshFail).toBeDefined()
    expect(refreshFail.message).toContain("Token refresh failed")
  })

  test("parses all-passing vitest text output", () => {
    const text = readFileSync(resolve(fixturesDir, "vitest-text-pass.txt"), "utf-8")
    const facts = parseVitestOutput(makeInput(text))

    // 5 individual tests + 2 suite-level ✓ lines = 7
    expect(facts.length).toBe(7)
    for (const f of facts as any[]) {
      expect(f.outcome).toBe("pass")
    }
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseVitestOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseVitestOutput(makeInput("this is not test output at all"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseVitestOutput({
      tool_name: "Bash",
      tool_input: { command: "vitest" },
    })).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    expect(parseVitestOutput(makeInput('{"broken": true'))).toEqual([])
  })

  test("returns empty array on JSON with no testResults", () => {
    expect(parseVitestOutput(makeInput('{"unrelated": "data"}'))).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseVitestOutput(makeInput(binary))).toEqual([])
  })
})
