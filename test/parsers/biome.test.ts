/**
 * Tests for the biome linter parser.
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseBiomeOutput } from "../../src/parsers/biome.js"
import type { HookInput } from "../../src/parsers/Parser.js"
import type { LintResult } from "../../src/Facts.js"

const fixturesDir = resolve(import.meta.dir, "../../fixtures/tool-outputs")

const makeInput = (output: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: "biome check src/" },
  tool_output: output,
})

describe("Biome parser", () => {
  // ── JSON parsing ──────────────────────────────────────────

  test("parses biome JSON output correctly", () => {
    const json = readFileSync(resolve(fixturesDir, "biome-json.json"), "utf-8")
    const facts = parseBiomeOutput(makeInput(json))

    expect(facts.length).toBe(5)
    for (const f of facts) {
      expect(f._tag).toBe("LintResult")
    }

    const results = facts as unknown as LintResult[]

    const noConsole = results.find((r) => r.rule === "lint/suspicious/noConsoleLog")
    expect(noConsole).toBeDefined()
    expect(noConsole!.file_path).toBe("src/auth.ts")
    expect(noConsole!.severity).toBe("error")

    const noForEach = results.find((r) => r.rule === "lint/complexity/noForEach")
    expect(noForEach).toBeDefined()
    expect(noForEach!.file_path).toBe("src/auth.ts")
    expect(noForEach!.severity).toBe("error")

    const noVar = results.find((r) => r.rule === "lint/style/noVar")
    expect(noVar).toBeDefined()
    expect(noVar!.file_path).toBe("src/utils.ts")
    expect(noVar!.severity).toBe("error")

    const noUnused = results.find((r) => r.rule === "lint/correctness/noUnusedVariables")
    expect(noUnused).toBeDefined()
    expect(noUnused!.file_path).toBe("src/utils.ts")
    expect(noUnused!.severity).toBe("warning")

    const noAny = results.find((r) => r.rule === "lint/suspicious/noExplicitAny")
    expect(noAny).toBeDefined()
    expect(noAny!.file_path).toBe("src/routes.ts")
    expect(noAny!.severity).toBe("error")
  })

  // ── Text parsing ──────────────────────────────────────────

  test("parses biome default text output", () => {
    const text = readFileSync(resolve(fixturesDir, "biome-text.txt"), "utf-8")
    const facts = parseBiomeOutput(makeInput(text))

    expect(facts.length).toBe(5)

    const results = facts as unknown as LintResult[]

    const noConsole = results.find((r) => r.rule === "lint/suspicious/noConsoleLog")
    expect(noConsole).toBeDefined()
    expect(noConsole!.file_path).toBe("src/auth.ts")
    expect(noConsole!.line).toBe(10)

    const noForEach = results.find((r) => r.rule === "lint/complexity/noForEach")
    expect(noForEach).toBeDefined()
    expect(noForEach!.file_path).toBe("src/auth.ts")
    expect(noForEach!.line).toBe(22)

    const noVar = results.find((r) => r.rule === "lint/style/noVar")
    expect(noVar).toBeDefined()
    expect(noVar!.file_path).toBe("src/utils.ts")
    expect(noVar!.line).toBe(5)

    const noUnused = results.find((r) => r.rule === "lint/correctness/noUnusedVariables")
    expect(noUnused).toBeDefined()
    expect(noUnused!.file_path).toBe("src/utils.ts")
    expect(noUnused!.line).toBe(15)

    const noAny = results.find((r) => r.rule === "lint/suspicious/noExplicitAny")
    expect(noAny).toBeDefined()
    expect(noAny!.file_path).toBe("src/routes.ts")
    expect(noAny!.line).toBe(8)
  })

  test("returns empty array on clean biome output", () => {
    const text = readFileSync(resolve(fixturesDir, "biome-clean.txt"), "utf-8")
    const facts = parseBiomeOutput(makeInput(text))
    expect(facts).toEqual([])
  })

  // ── Never-throw tests ─────────────────────────────────────

  test("returns empty array on empty output", () => {
    expect(parseBiomeOutput(makeInput(""))).toEqual([])
  })

  test("returns empty array on garbage input", () => {
    expect(parseBiomeOutput(makeInput("this is not biome output"))).toEqual([])
  })

  test("returns empty array on undefined tool_output", () => {
    expect(parseBiomeOutput({
      tool_name: "Bash",
      tool_input: { command: "biome check ." },
    })).toEqual([])
  })

  test("returns empty array on malformed JSON", () => {
    expect(parseBiomeOutput(makeInput('{"broken":'))).toEqual([])
  })

  test("returns empty array on JSON without diagnostics", () => {
    expect(parseBiomeOutput(makeInput('{"command": "lint"}'))).toEqual([])
  })

  test("returns empty array on binary data", () => {
    const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]).toString()
    expect(parseBiomeOutput(makeInput(binary))).toEqual([])
  })

  test("returns empty array on empty diagnostics array", () => {
    expect(parseBiomeOutput(makeInput('{"diagnostics": []}'))).toEqual([])
  })
})
