/**
 * Tests for the eslint parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEslintOutput } from "../../src/parsers/eslint.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import type { LintResult } from "../../src/Facts.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "eslint src/" },
  tool_output: output,
})

describe("ESLint parser", () => {
  // ── JSON parsing ──────────────────────────────────────────

  test("parses eslint JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "eslint-json.json"), "utf-8")
    const facts = parseEslintOutput(makeInput(json))

    // 3 messages in auth.ts + 1 in utils.ts + 0 in clean.ts = 4
    expect(facts.length).toBe(4)

    for (const f of facts) {
      expect(f._tag).toBe("LintResult")
    }

    const results = facts as unknown as LintResult[]

    // Check auth.ts errors
    const noConsole = results.find((r) => r.rule === "no-console")
    expect(noConsole).toBeDefined()
    expect(noConsole!.file_path).toBe("/home/user/project/src/auth.ts")
    expect(noConsole!.line).toBe(10)
    expect(noConsole!.severity).toBe("warning")

    const noUnused = results.find((r) => r.rule === "@typescript-eslint/no-unused-vars")
    expect(noUnused).toBeDefined()
    expect(noUnused!.line).toBe(15)
    expect(noUnused!.severity).toBe("error")

    const semi = results.find((r) => r.rule === "semi")
    expect(semi).toBeDefined()
    expect(semi!.line).toBe(22)
    expect(semi!.severity).toBe("error")

    // Check utils.ts error
    const noVar = results.find((r) => r.rule === "no-var")
    expect(noVar).toBeDefined()
    expect(noVar!.file_path).toBe("/home/user/project/src/utils.ts")
    expect(noVar!.line).toBe(5)
    expect(noVar!.severity).toBe("error")
  })

  // ── Text parsing ──────────────────────────────────────────

  test("parses eslint default text output", () => {
    const text = readFileSync(resolve(fixturesDir, "eslint-text.txt"), "utf-8")
    const facts = parseEslintOutput(makeInput(text))

    expect(facts.length).toBe(4)

    const results = facts as unknown as LintResult[]

    const noConsole = results.find((r) => r.rule === "no-console")
    expect(noConsole).toBeDefined()
    expect(noConsole!.file_path).toBe("/home/user/project/src/auth.ts")
    expect(noConsole!.line).toBe(10)
    expect(noConsole!.severity).toBe("warning")

    const noVar = results.find((r) => r.rule === "no-var")
    expect(noVar).toBeDefined()
    expect(noVar!.file_path).toBe("/home/user/project/src/utils.ts")
    expect(noVar!.line).toBe(5)
    expect(noVar!.severity).toBe("error")

    const semi = results.find((r) => r.rule === "semi")
    expect(semi).toBeDefined()
    expect(semi!.severity).toBe("error")
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseEslintOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseEslintOutput(makeInput("this is not eslint output"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseEslintOutput({
      tool_name: "Bash",
      tool_input: { command: "eslint ." },
    })).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    expect(parseEslintOutput(makeInput('{"broken": true'))).toEqual([])
  })

  test("returns empty array on JSON with no messages", () => {
    expect(parseEslintOutput(makeInput('[{"filePath": "/a.ts", "messages": []}]'))).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseEslintOutput(makeInput(binary))).toEqual([])
  })

  test("returns empty array on non-array JSON", () => {
    expect(parseEslintOutput(makeInput('{"something": true}'))).toEqual([])
  })
})
