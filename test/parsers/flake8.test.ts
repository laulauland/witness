/**
 * Tests for the flake8/ruff parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseFlake8Output } from "../../src/parsers/flake8.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import type { LintResult } from "../../src/Facts.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "flake8 src/" },
  tool_output: output,
})

describe("Flake8/Ruff parser", () => {
  // ── Text parsing ──────────────────────────────────────────

  test("parses flake8 text output correctly", () => {
    const text = readFileSync(resolve(fixturesDir, "flake8-text.txt"), "utf-8")
    const facts = parseFlake8Output(makeInput(text))

    expect(facts.length).toBe(6)

    for (const f of facts) {
      expect(f._tag).toBe("LintResult")
    }

    const results = facts as unknown as LintResult[]

    const e302 = results.find((r) => r.rule === "E302")
    expect(e302).toBeDefined()
    expect(e302!.file_path).toBe("src/auth.py")
    expect(e302!.line).toBe(10)
    expect(e302!.severity).toBe("error")

    const e501 = results.find((r) => r.rule === "E501")
    expect(e501).toBeDefined()
    expect(e501!.line).toBe(15)

    const w291 = results.find((r) => r.rule === "W291")
    expect(w291).toBeDefined()
    expect(w291!.severity).toBe("warning")
    expect(w291!.line).toBe(22)

    const f401 = results.find((r) => r.rule === "F401")
    expect(f401).toBeDefined()
    expect(f401!.file_path).toBe("src/utils.py")
    expect(f401!.line).toBe(3)
    expect(f401!.severity).toBe("error")

    const c901 = results.find((r) => r.rule === "C901")
    expect(c901).toBeDefined()
    expect(c901!.file_path).toBe("src/models.py")
    expect(c901!.line).toBe(42)
  })

  // ── JSON parsing (ruff) ───────────────────────────────────

  test("parses ruff JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "ruff-json.json"), "utf-8")
    const facts = parseFlake8Output(makeInput(json))

    expect(facts.length).toBe(3)

    const results = facts as unknown as LintResult[]

    const e302 = results.find((r) => r.rule === "E302")
    expect(e302).toBeDefined()
    expect(e302!.file_path).toBe("src/auth.py")
    expect(e302!.line).toBe(10)
    expect(e302!.severity).toBe("error")

    const f401 = results.find((r) => r.rule === "F401")
    expect(f401).toBeDefined()
    expect(f401!.file_path).toBe("src/utils.py")
    expect(f401!.line).toBe(3)

    const w291 = results.find((r) => r.rule === "W291")
    expect(w291).toBeDefined()
    expect(w291!.severity).toBe("warning")
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseFlake8Output(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseFlake8Output(makeInput("random text here"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseFlake8Output({
      tool_name: "Bash",
      tool_input: { command: "flake8 ." },
    })).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    expect(parseFlake8Output(makeInput('[{"broken"'))).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseFlake8Output(makeInput(binary))).toEqual([])
  })

  test("handles single-line output", () => {
    const facts = parseFlake8Output(makeInput("app.py:1:1: F401 'os' imported but unused"))
    expect(facts.length).toBe(1)
    const r = facts[0] as unknown as LintResult
    expect(r.file_path).toBe("app.py")
    expect(r.line).toBe(1)
    expect(r.rule).toBe("F401")
  })
})
