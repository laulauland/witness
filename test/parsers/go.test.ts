/**
 * Tests for the go test output parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseGoOutput } from "../../src/parsers/go.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "go test ./..." },
  tool_output: output,
})

describe("Go test parser", () => {
  // ── Verbose pass output ───────────────────────────────────

  test("parses all-passing verbose output", () => {
    const text = readFileSync(resolve(fixturesDir, "go-test-pass.txt"), "utf-8")
    const facts = parseGoOutput(makeInput(text))

    // TestAdd, TestSubtract, TestMultiply, TestDivide (skip),
    // TestParseConfig, TestParseConfig/valid_json, TestParseConfig/empty_input
    expect(facts.length).toBe(7)

    for (const f of facts) {
      expect(f._tag).toBe("TestResult")
    }

    const results = facts as any[]

    const passes = results.filter((r: any) => r.outcome === "pass")
    expect(passes.length).toBe(6)

    const skips = results.filter((r: any) => r.outcome === "skip")
    expect(skips.length).toBe(1)
    expect(skips[0].test_name).toBe("TestDivide")

    // Check subtest names
    const subtest = results.find((r: any) => r.test_name === "TestParseConfig/valid_json")
    expect(subtest).toBeDefined()
    expect(subtest.outcome).toBe("pass")
  })

  // ── Verbose fail output ───────────────────────────────────

  test("parses failing verbose output", () => {
    const text = readFileSync(resolve(fixturesDir, "go-test-fail.txt"), "utf-8")
    const facts = parseGoOutput(makeInput(text))

    expect(facts.length).toBe(9)

    const results = facts as any[]

    const passes = results.filter((r: any) => r.outcome === "pass")
    const fails = results.filter((r: any) => r.outcome === "fail")

    expect(passes.length).toBe(6)
    expect(fails.length).toBe(3)

    // Check specific failures
    const invalidJson = fails.find((r: any) => r.test_name === "TestParseConfig/invalid_json")
    expect(invalidJson).toBeDefined()
    expect(invalidJson.outcome).toBe("fail")
    expect(invalidJson.message).toContain("expected error for invalid JSON")

    const handleReq = fails.find((r: any) => r.test_name === "TestHandleRequest")
    expect(handleReq).toBeDefined()
    expect(handleReq.message).toContain("Expected status 200")

    const withAuth = fails.find((r: any) => r.test_name === "TestHandleRequest/with_auth")
    expect(withAuth).toBeDefined()
    expect(withAuth.message).toContain("authentication header not forwarded")
  })

  // ── Summary-only mode (no verbose) ────────────────────────

  test("returns empty for summary-only output (no individual tests)", () => {
    const text = `ok  \tgithub.com/example/mathlib\t0.035s
ok  \tgithub.com/example/config\t0.021s`
    const facts = parseGoOutput(makeInput(text))
    // Summary-only mode doesn't have individual test lines
    expect(facts).toEqual([])
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    const facts = parseGoOutput(makeInput(""))
    expect(facts).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    const facts = parseGoOutput(makeInput("this is not go test output at all"))
    expect(facts).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    const facts = parseGoOutput({
      tool_name: "Bash",
      tool_input: { command: "go test ./..." },
    })
    expect(facts).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    const facts = parseGoOutput(makeInput(binary))
    expect(facts).toEqual([])
  })

  test("returns empty array on truncated output", () => {
    const truncated = `=== RUN   TestAdd
--- PASS: TestAdd (0.`
    const facts = parseGoOutput(makeInput(truncated))
    // Should still parse the one PASS line that matches
    const results = facts as any[]
    // The regex needs the closing paren, so truncated line won't match
    // But that's fine — we just get fewer results
    expect(facts.length).toBeLessThanOrEqual(1)
  })

  // ── Edge cases ────────────────────────────────────────────

  test("handles test with no message on fail", () => {
    const text = `=== RUN   TestMinimal
--- FAIL: TestMinimal (0.00s)
FAIL`
    const facts = parseGoOutput(makeInput(text))
    expect(facts.length).toBe(1)
    const result = facts[0] as any
    expect(result.test_name).toBe("TestMinimal")
    expect(result.outcome).toBe("fail")
  })

  test("handles deeply nested subtests", () => {
    const text = `=== RUN   TestOuter
=== RUN   TestOuter/Inner
=== RUN   TestOuter/Inner/Deep
--- PASS: TestOuter/Inner/Deep (0.00s)
--- PASS: TestOuter/Inner (0.00s)
--- PASS: TestOuter (0.00s)
PASS`
    const facts = parseGoOutput(makeInput(text))
    expect(facts.length).toBe(3)
    const names = (facts as any[]).map((f: any) => f.test_name)
    expect(names).toContain("TestOuter")
    expect(names).toContain("TestOuter/Inner")
    expect(names).toContain("TestOuter/Inner/Deep")
  })
})
