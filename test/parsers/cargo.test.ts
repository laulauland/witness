/**
 * Tests for the cargo test output parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseCargoOutput } from "../../src/parsers/cargo.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "cargo test" },
  tool_output: output,
})

describe("Cargo test parser", () => {
  // ── All passing ───────────────────────────────────────────

  test("parses all-passing cargo test output", () => {
    const text = readFileSync(resolve(fixturesDir, "cargo-test-pass.txt"), "utf-8")
    const facts = parseCargoOutput(makeInput(text))

    // 5 unit tests + 2 integration tests + 1 doc test = 8
    expect(facts.length).toBe(8)

    for (const f of facts) {
      expect(f._tag).toBe("TestResult")
    }

    const results = facts as any[]

    for (const r of results) {
      expect(r.outcome).toBe("pass")
    }

    // Check specific test names
    const names = results.map((r: any) => r.test_name)
    expect(names).toContain("math::tests::test_add")
    expect(names).toContain("math::tests::test_subtract")
    expect(names).toContain("config::tests::test_parse_valid")
    expect(names).toContain("test_full_pipeline")
    expect(names).toContain("test_error_handling")
  })

  // ── Failing tests ─────────────────────────────────────────

  test("parses failing cargo test output", () => {
    const text = readFileSync(resolve(fixturesDir, "cargo-test-fail.txt"), "utf-8")
    const facts = parseCargoOutput(makeInput(text))

    expect(facts.length).toBe(6)

    const results = facts as any[]

    const passes = results.filter((r: any) => r.outcome === "pass")
    const fails = results.filter((r: any) => r.outcome === "fail")

    expect(passes.length).toBe(4)
    expect(fails.length).toBe(2)

    // Check specific failures with messages
    const multiplyFail = fails.find((r: any) => r.test_name === "math::tests::test_multiply")
    expect(multiplyFail).toBeDefined()
    expect(multiplyFail.outcome).toBe("fail")
    expect(multiplyFail.message).toContain("assertion")

    const parseFail = fails.find((r: any) => r.test_name === "config::tests::test_parse_empty")
    expect(parseFail).toBeDefined()
    expect(parseFail.outcome).toBe("fail")
    expect(parseFail.message).toContain("unexpected end of input")
  })

  // ── Ignored tests ─────────────────────────────────────────

  test("handles ignored tests as skip", () => {
    const text = `running 3 tests
test math::tests::test_add ... ok
test math::tests::test_slow ... ignored
test math::tests::test_subtract ... ok

test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s`
    const facts = parseCargoOutput(makeInput(text))

    expect(facts.length).toBe(3)

    const results = facts as any[]
    const ignored = results.find((r: any) => r.test_name === "math::tests::test_slow")
    expect(ignored).toBeDefined()
    expect(ignored.outcome).toBe("skip")
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    const facts = parseCargoOutput(makeInput(""))
    expect(facts).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    const facts = parseCargoOutput(makeInput("this is not cargo test output at all"))
    expect(facts).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    const facts = parseCargoOutput({
      tool_name: "Bash",
      tool_input: { command: "cargo test" },
    })
    expect(facts).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    const facts = parseCargoOutput(makeInput(binary))
    expect(facts).toEqual([])
  })

  test("returns empty array on malformed output", () => {
    const facts = parseCargoOutput(makeInput('{"json": "not cargo output"}'))
    expect(facts).toEqual([])
  })

  // ── Edge cases ────────────────────────────────────────────

  test("handles doc-tests", () => {
    const text = `   Doc-tests mylib

running 2 tests
test src/lib.rs - add (line 5) ... ok
test src/lib.rs - subtract (line 15) ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s`
    const facts = parseCargoOutput(makeInput(text))
    expect(facts.length).toBe(2)
    const names = (facts as any[]).map((r: any) => r.test_name)
    expect(names[0]).toContain("src/lib.rs")
  })

  test("handles single failing test with no failures section", () => {
    const text = `running 1 test
test basic::test_something ... FAILED

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`
    const facts = parseCargoOutput(makeInput(text))
    expect(facts.length).toBe(1)
    const result = facts[0] as any
    expect(result.test_name).toBe("basic::test_something")
    expect(result.outcome).toBe("fail")
    expect(result.message).toBeNull()
  })

  test("handles test names with special characters", () => {
    const text = `running 1 tests
test it_works_with_special_chars_123 ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s`
    const facts = parseCargoOutput(makeInput(text))
    expect(facts.length).toBe(1)
    expect((facts[0] as any).test_name).toBe("it_works_with_special_chars_123")
  })
})
