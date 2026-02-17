/**
 * Tests for the bun test parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseBunTestOutput } from "../../src/parsers/buntest.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "bun test" },
  tool_output: output,
})

describe("Bun test parser", () => {
  // ── Failing output ────────────────────────────────────────

  test("parses bun test output with pass and fail", () => {
    const text = readFileSync(resolve(fixturesDir, "bun-test-fail.txt"), "utf-8")
    const facts = parseBunTestOutput(makeInput(text))

    expect(facts.length).toBe(10)
    for (const f of facts) {
      expect(f._tag).toBe("TestResult")
    }

    const results = facts as any[]

    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBe(8)

    const fails = results.filter((r: any) => r.outcome === "fail")
    expect(fails.length).toBe(2)

    // Check specific pass
    const validate = results.find((r: any) => r.test_name === "Auth > should validate token")
    expect(validate).toBeDefined()
    expect(validate.outcome).toBe("pass")

    // Check specific fail with error message
    const refresh = results.find((r: any) => r.test_name === "Auth > should refresh expired token")
    expect(refresh).toBeDefined()
    expect(refresh.outcome).toBe("fail")
    expect(refresh.message).toContain("expect(received).toBe(expected)")

    // Check fail with TypeError
    const revocation = results.find((r: any) => r.test_name === "Auth > should handle revocation")
    expect(revocation).toBeDefined()
    expect(revocation.outcome).toBe("fail")
    expect(revocation.message).toContain("TypeError")
  })

  // ── Passing output ────────────────────────────────────────

  test("parses all-passing bun test output", () => {
    const text = readFileSync(resolve(fixturesDir, "bun-test-pass.txt"), "utf-8")
    const facts = parseBunTestOutput(makeInput(text))

    expect(facts.length).toBe(7)
    for (const f of facts as any[]) {
      expect(f.outcome).toBe("pass")
    }

    const results = facts as any[]
    const validate = results.find((r: any) => r.test_name === "Auth > should validate token")
    expect(validate).toBeDefined()

    const db = results.find((r: any) => r.test_name === "Database > should connect")
    expect(db).toBeDefined()
  })

  // ── Edge cases ────────────────────────────────────────────

  test("handles (pass)/(fail) without duration", () => {
    const output = `(pass) some test
(fail) another test
      error: something broke`
    const facts = parseBunTestOutput(makeInput(output))
    expect(facts.length).toBe(2)

    const results = facts as any[]
    expect(results[0].outcome).toBe("pass")
    expect(results[0].test_name).toBe("some test")
    expect(results[1].outcome).toBe("fail")
    expect(results[1].test_name).toBe("another test")
    expect(results[1].message).toContain("something broke")
  })

  test("handles nested describe names", () => {
    const output = `(pass) Auth > Token > should validate [1ms]
(pass) Auth > Token > should refresh [2ms]`
    const facts = parseBunTestOutput(makeInput(output))
    expect(facts.length).toBe(2)

    const results = facts as any[]
    expect(results[0].test_name).toBe("Auth > Token > should validate")
    expect(results[1].test_name).toBe("Auth > Token > should refresh")
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseBunTestOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseBunTestOutput(makeInput("this is not bun test output"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseBunTestOutput({
      tool_name: "Bash",
      tool_input: { command: "bun test" },
    })).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseBunTestOutput(makeInput(binary))).toEqual([])
  })

  test("returns empty array on JSON data", () => {
    expect(parseBunTestOutput(makeInput('{"some": "json"}'))).toEqual([])
  })
})
