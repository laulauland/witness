/**
 * Tests for the mypy/pyright parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseMypyOutput } from "../../src/parsers/mypy.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import type { TypeError } from "../../src/Facts.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "mypy src/" },
  tool_output: output,
})

describe("Mypy parser", () => {
  // ── Mypy output ───────────────────────────────────────────

  test("parses mypy errors correctly", () => {
    const text = readFileSync(resolve(fixturesDir, "mypy-errors.txt"), "utf-8")
    const facts = parseMypyOutput(makeInput(text))

    // 4 errors (note lines are skipped)
    expect(facts.length).toBe(4)

    for (const f of facts) {
      expect(f._tag).toBe("TypeError")
    }

    const results = facts as unknown as TypeError[]

    const assignment = results.find((r) => r.message.includes("Incompatible types in assignment"))
    expect(assignment).toBeDefined()
    expect(assignment!.file_path).toBe("src/auth.py")
    expect(assignment!.line).toBe(10)

    const attr = results.find((r) => r.message.includes("has no attribute"))
    expect(attr).toBeDefined()
    expect(attr!.file_path).toBe("src/auth.py")
    expect(attr!.line).toBe(25)

    const importErr = results.find((r) => r.message.includes("missing_module"))
    expect(importErr).toBeDefined()
    expect(importErr!.file_path).toBe("src/utils.py")
    expect(importErr!.line).toBe(3)

    const argType = results.find((r) => r.message.includes("Argument 1"))
    expect(argType).toBeDefined()
    expect(argType!.file_path).toBe("src/models.py")
    expect(argType!.line).toBe(42)
  })

  test("skips note lines", () => {
    const text = readFileSync(resolve(fixturesDir, "mypy-errors.txt"), "utf-8")
    const facts = parseMypyOutput(makeInput(text))
    // Should NOT include the note line
    const results = facts as unknown as TypeError[]
    const noteResult = results.find((r) => r.message.includes("See class definition"))
    expect(noteResult).toBeUndefined()
  })

  // ── Pyright output ────────────────────────────────────────

  test("parses pyright errors correctly", () => {
    const text = readFileSync(resolve(fixturesDir, "pyright-errors.txt"), "utf-8")
    const facts = parseMypyOutput(makeInput(text))

    expect(facts.length).toBe(3)

    const results = facts as unknown as TypeError[]

    expect(results[0]!.file_path).toBe("src/auth.py")
    expect(results[0]!.line).toBe(10)
    expect(results[0]!.message).toContain("cannot be assigned")

    expect(results[1]!.file_path).toBe("src/auth.py")
    expect(results[1]!.line).toBe(25)
    expect(results[1]!.message).toContain("Cannot access member")

    expect(results[2]!.file_path).toBe("src/utils.py")
    expect(results[2]!.line).toBe(3)
    expect(results[2]!.message).toContain("could not be resolved")
  })

  // ── Single error ──────────────────────────────────────────

  test("parses a single mypy error", () => {
    const facts = parseMypyOutput(makeInput(
      'app.py:5: error: Name "foo" is not defined  [name-defined]'
    ))
    expect(facts.length).toBe(1)
    const r = facts[0] as unknown as TypeError
    expect(r.file_path).toBe("app.py")
    expect(r.line).toBe(5)
    expect(r.message).toContain("foo")
  })

  test("parses mypy error with column", () => {
    const facts = parseMypyOutput(makeInput(
      'app.py:5:10: error: Name "foo" is not defined'
    ))
    expect(facts.length).toBe(1)
    const r = facts[0] as unknown as TypeError
    expect(r.file_path).toBe("app.py")
    expect(r.line).toBe(5)
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseMypyOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseMypyOutput(makeInput("this is not mypy output"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseMypyOutput({
      tool_name: "Bash",
      tool_input: { command: "mypy ." },
    })).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseMypyOutput(makeInput(binary))).toEqual([])
  })

  test("returns empty array on success output", () => {
    expect(parseMypyOutput(makeInput("Success: no issues found in 5 source files"))).toEqual([])
  })

  test("returns empty array on only note lines", () => {
    expect(parseMypyOutput(makeInput("src/foo.py:10: note: This is just a note"))).toEqual([])
  })
})
