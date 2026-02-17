/**
 * Tests for the parser router.
 */
import { describe, it, expect } from "bun:test"
import { route, routeWithInput } from "../../src/parsers/index.js"
import { parseFileEvent } from "../../src/parsers/file.js"
import { parseJestOutput } from "../../src/parsers/jest.js"
import { parsePytestOutput } from "../../src/parsers/pytest.js"
import { parseEslintOutput } from "../../src/parsers/eslint.js"
import { parseFlake8Output } from "../../src/parsers/flake8.js"
import { parseTscOutput } from "../../src/parsers/tsc.js"
import { parseMypyOutput } from "../../src/parsers/mypy.js"
import { parseGoOutput } from "../../src/parsers/go.js"
import { parseCargoOutput } from "../../src/parsers/cargo.js"
import { parseVitestOutput } from "../../src/parsers/vitest.js"
import { parseBunTestOutput } from "../../src/parsers/buntest.js"
import { parseBiomeOutput } from "../../src/parsers/biome.js"

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

  it("routes 'vitest' to vitest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "vitest run" } })
    ).toBe(parseVitestOutput)
  })

  it("routes 'bun test' to bun test parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bun test" } })
    ).toBe(parseBunTestOutput)
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
    ).toBe(parseBunTestOutput)
  })

  // ── Go test commands ──────────────────────────────────────

  it("routes 'go test' to go parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "go test ./..." } })
    ).toBe(parseGoOutput)
  })

  it("routes 'go test -v' to go parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "go test -v ./pkg/..." } })
    ).toBe(parseGoOutput)
  })

  it("routes 'go test -run TestFoo' to go parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "go test -run TestFoo" } })
    ).toBe(parseGoOutput)
  })

  // ── Cargo test commands ───────────────────────────────────

  it("routes 'cargo test' to cargo parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "cargo test" } })
    ).toBe(parseCargoOutput)
  })

  it("routes 'cargo test --lib' to cargo parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "cargo test --lib" } })
    ).toBe(parseCargoOutput)
  })

  it("routes 'cargo test specific_test' to cargo parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "cargo test math::tests::test_add" } })
    ).toBe(parseCargoOutput)
  })

  // ── ESLint commands ───────────────────────────────────────

  it("routes 'eslint' to eslint parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "eslint src/" } })
    ).toBe(parseEslintOutput)
  })

  it("routes 'npx eslint' to eslint parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npx eslint --fix src/" } })
    ).toBe(parseEslintOutput)
  })

  it("routes 'yarn eslint' to eslint parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "yarn eslint ." } })
    ).toBe(parseEslintOutput)
  })

  // ── Flake8/Ruff commands ──────────────────────────────────

  it("routes 'flake8' to flake8 parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "flake8 src/" } })
    ).toBe(parseFlake8Output)
  })

  it("routes 'ruff check' to flake8 parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "ruff check ." } })
    ).toBe(parseFlake8Output)
  })

  it("routes plain 'ruff' to flake8 parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "ruff src/" } })
    ).toBe(parseFlake8Output)
  })

  it("routes 'python -m flake8' to flake8 parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "python -m flake8 src/" } })
    ).toBe(parseFlake8Output)
  })

  // ── tsc commands ──────────────────────────────────────────

  it("routes 'tsc' to tsc parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "tsc --noEmit" } })
    ).toBe(parseTscOutput)
  })

  it("routes 'npx tsc' to tsc parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npx tsc --noEmit" } })
    ).toBe(parseTscOutput)
  })

  it("routes 'bunx tsc' to tsc parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bunx tsc --noEmit" } })
    ).toBe(parseTscOutput)
  })

  // ── mypy/pyright commands ─────────────────────────────────

  it("routes 'mypy' to mypy parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "mypy src/" } })
    ).toBe(parseMypyOutput)
  })

  it("routes 'pyright' to mypy parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "pyright" } })
    ).toBe(parseMypyOutput)
  })

  it("routes 'python -m mypy' to mypy parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "python -m mypy src/" } })
    ).toBe(parseMypyOutput)
  })

  // ── Vitest commands (dedicated parser) ────────────────────

  it("routes 'vitest' to vitest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "vitest" } })
    ).toBe(parseVitestOutput)
  })

  it("routes 'npx vitest' to vitest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npx vitest run" } })
    ).toBe(parseVitestOutput)
  })

  it("routes 'bunx vitest' to vitest parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bunx vitest --reporter=json" } })
    ).toBe(parseVitestOutput)
  })

  // ── Bun test commands (dedicated parser) ──────────────────

  it("routes 'bun test' to bun test parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bun test" } })
    ).toBe(parseBunTestOutput)
  })

  it("routes 'bun test src/' to bun test parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bun test src/" } })
    ).toBe(parseBunTestOutput)
  })

  it("routes 'bun test --timeout 5000' to bun test parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bun test --timeout 5000" } })
    ).toBe(parseBunTestOutput)
  })

  // ── Biome commands ────────────────────────────────────────

  it("routes 'biome check' to biome parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "biome check src/" } })
    ).toBe(parseBiomeOutput)
  })

  it("routes 'biome lint' to biome parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "biome lint ." } })
    ).toBe(parseBiomeOutput)
  })

  it("routes 'biome ci' to biome parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "biome ci" } })
    ).toBe(parseBiomeOutput)
  })

  it("routes 'npx biome check' to biome parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "npx biome check ." } })
    ).toBe(parseBiomeOutput)
  })

  it("routes 'bunx biome lint' to biome parser", () => {
    expect(
      routeWithInput({ tool_name: "Bash", tool_input: { command: "bunx biome lint src/" } })
    ).toBe(parseBiomeOutput)
  })
})
