/**
 * Tests for the TypeScript compiler (tsc) parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseTscOutput } from "../../src/parsers/tsc.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import type { TypeError } from "../../src/Facts.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "npx tsc --noEmit" },
  tool_output: output,
})

describe("tsc parser", () => {
  // ── Standard paren format ─────────────────────────────────

  test("parses tsc paren format errors correctly", () => {
    const text = readFileSync(resolve(fixturesDir, "tsc-errors.txt"), "utf-8")
    const facts = parseTscOutput(makeInput(text))

    expect(facts.length).toBe(5)

    for (const f of facts) {
      expect(f._tag).toBe("TypeError")
    }

    const results = facts as unknown as TypeError[]

    const ts2345 = results.find((r) => r.message.includes("TS2345"))
    expect(ts2345).toBeDefined()
    expect(ts2345!.file_path).toBe("src/auth.ts")
    expect(ts2345!.line).toBe(10)
    expect(ts2345!.message).toContain("Argument of type 'string'")

    const ts2339 = results.find((r) => r.message.includes("TS2339"))
    expect(ts2339).toBeDefined()
    expect(ts2339!.file_path).toBe("src/auth.ts")
    expect(ts2339!.line).toBe(25)
    expect(ts2339!.message).toContain("Property 'foo'")

    const ts2304 = results.find((r) => r.message.includes("TS2304"))
    expect(ts2304).toBeDefined()
    expect(ts2304!.file_path).toBe("src/utils.ts")
    expect(ts2304!.line).toBe(3)

    const ts7006 = results.find((r) => r.message.includes("TS7006"))
    expect(ts7006).toBeDefined()
    expect(ts7006!.file_path).toBe("src/models.ts")
    expect(ts7006!.line).toBe(42)

    const ts2322 = results.find((r) => r.message.includes("TS2322"))
    expect(ts2322).toBeDefined()
    expect(ts2322!.file_path).toBe("src/index.ts")
    expect(ts2322!.line).toBe(8)
  })

  // ── Colon format ──────────────────────────────────────────

  test("parses tsc colon format errors correctly", () => {
    const text = readFileSync(resolve(fixturesDir, "tsc-colon-format.txt"), "utf-8")
    const facts = parseTscOutput(makeInput(text))

    expect(facts.length).toBe(3)

    const results = facts as unknown as TypeError[]

    expect(results[0]!.file_path).toBe("src/auth.ts")
    expect(results[0]!.line).toBe(10)
    expect(results[0]!.message).toContain("TS2345")

    expect(results[1]!.file_path).toBe("src/auth.ts")
    expect(results[1]!.line).toBe(25)

    expect(results[2]!.file_path).toBe("src/utils.ts")
    expect(results[2]!.line).toBe(3)
  })

  // ── Single error ──────────────────────────────────────────

  test("parses a single tsc error", () => {
    const facts = parseTscOutput(makeInput(
      "src/foo.ts(5,10): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
    ))
    expect(facts.length).toBe(1)
    const r = facts[0] as unknown as TypeError
    expect(r.file_path).toBe("src/foo.ts")
    expect(r.line).toBe(5)
    expect(r.message).toContain("TS2345")
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseTscOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseTscOutput(makeInput("this is not tsc output"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseTscOutput({
      tool_name: "Bash",
      tool_input: { command: "tsc --noEmit" },
    })).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseTscOutput(makeInput(binary))).toEqual([])
  })

  test("returns empty array on 'no errors' output", () => {
    expect(parseTscOutput(makeInput("Found 0 errors.\n"))).toEqual([])
  })

  test("ignores non-error lines in mixed output", () => {
    const output = `Version 5.3.3
src/foo.ts(1,1): error TS2304: Cannot find name 'x'.

Found 1 error.`
    const facts = parseTscOutput(makeInput(output))
    expect(facts.length).toBe(1)
  })
})
