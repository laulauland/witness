/**
 * Tests for the parser router.
 */
import { describe, it, expect } from "bun:test"
import { route, routeWithInput } from "../../src/parsers/index.js"
import { parseFileEvent } from "../../src/parsers/file.js"
import { parseJestOutput } from "../../src/parsers/jest.js"
import { parsePytestOutput } from "../../src/parsers/pytest.js"

describe("Parser router", () => {
  // ── File tools route to file parser ─────────────────────────

  it("routes Edit to file parser", () => {
    expect(route("Edit")).toBe(parseFileEvent)
  })

  it("routes edit (lowercase) to file parser", () => {
    expect(route("edit")).toBe(parseFileEvent)
  })

  it("routes str_replace_editor to file parser", () => {
    expect(route("str_replace_editor")).toBe(parseFileEvent)
  })

  it("routes Write to file parser", () => {
    expect(route("Write")).toBe(parseFileEvent)
  })

  it("routes write (lowercase) to file parser", () => {
    expect(route("write")).toBe(parseFileEvent)
  })

  it("routes file_create to file parser", () => {
    expect(route("file_create")).toBe(parseFileEvent)
  })

  it("routes create_file to file parser", () => {
    expect(route("create_file")).toBe(parseFileEvent)
  })

  it("routes Read to file parser", () => {
    expect(route("Read")).toBe(parseFileEvent)
  })

  it("routes read (lowercase) to file parser", () => {
    expect(route("read")).toBe(parseFileEvent)
  })

  it("routes view to file parser", () => {
    expect(route("view")).toBe(parseFileEvent)
  })

  it("routes cat to file parser", () => {
    expect(route("cat")).toBe(parseFileEvent)
  })

  // ── Unknown tools return undefined ──────────────────────────

  it("returns undefined for Bash (simple route)", () => {
    expect(route("Bash")).toBeUndefined()
  })

  it("returns undefined for unknown tool", () => {
    expect(route("SomeRandomTool")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(route("")).toBeUndefined()
  })
})

describe("Parser router (routeWithInput)", () => {
  // ── File tools ────────────────────────────────────────────

  it("routes Edit via routeWithInput", () => {
    expect(
      routeWithInput({ tool_name: "Edit", tool_input: { path: "a.ts" } })
    ).toBe(parseFileEvent)
  })

  // ── Jest/Vitest commands ──────────────────────────────────

  it("routes 'jest' command to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "jest" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'npx jest' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npx jest --json" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'vitest' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "vitest run" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'bun test' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bun test" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'npm test' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npm test" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'yarn test' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "yarn test" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'pnpm test' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "pnpm test" } })
    ).toBe(parseJestOutput)
  })

  it("routes 'mocha' to jest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "mocha" } })
    ).toBe(parseJestOutput)
  })

  // ── Pytest commands ───────────────────────────────────────

  it("routes 'pytest' to pytest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "pytest" } })
    ).toBe(parsePytestOutput)
  })

  it("routes 'python -m pytest' to pytest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "python -m pytest tests/" } })
    ).toBe(parsePytestOutput)
  })

  it("routes 'py.test' to pytest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "py.test -v" } })
    ).toBe(parsePytestOutput)
  })

  // ── Non-test Bash commands ────────────────────────────────

  it("returns undefined for non-test Bash command", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "ls -la" } })
    ).toBeUndefined()
  })

  it("returns undefined for git commit", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "git commit -m 'fix'" } })
    ).toBeUndefined()
  })

  it("returns undefined for unknown tool", () => {
    expect(
      routeWithInput({ tool_name: "SomeRandomTool", tool_input: {} })
    ).toBeUndefined()
  })

  // ── Alternate Bash tool names ─────────────────────────────

  it("routes bash (lowercase) with jest command", () => {
    expect(
      routeWithInput({ tool_name: "bash", tool_input: { command: "jest" } })
    ).toBe(parseJestOutput)
  })

  it("routes terminal with pytest command", () => {
    expect(
      routeWithInput({ tool_name: "terminal", tool_input: { command: "pytest" } })
    ).toBe(parsePytestOutput)
  })

  it("handles 'cmd' field instead of 'command'", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { cmd: "bun test" } })
    ).toBe(parseJestOutput)
  })
})
