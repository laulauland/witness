/**
 * Parser router: maps tool_name (+ optional command pattern) to the correct parser function.
 *
 * Phase 2: file parser (Edit/Write/Read)
 * Phase 4: jest/vitest + pytest parsers (Bash with matching commands)
 * Phase 8: eslint, flake8/ruff, tsc, mypy/pyright parsers
 */
import type { Parser, ParserRouter, HookInput } from "./Parser.js"
import { parseFileEvent } from "./file.js"
import { parseJestOutput } from "./jest.js"
import { parsePytestOutput } from "./pytest.js"
import { parseEslintOutput } from "./eslint.js"
import { parseFlake8Output } from "./flake8.js"
import { parseTscOutput } from "./tsc.js"
import { parseMypyOutput } from "./mypy.js"
import { parseGoOutput } from "./go.js"
import { parseCargoOutput } from "./cargo.js"

/**
 * Tool names that produce file events.
 */
const FILE_TOOLS = new Set([
  "Edit",
  "edit",
  "str_replace_editor",
  "Write",
  "write",
  "file_create",
  "create_file",
  "Read",
  "read",
  "view",
  "cat",
])

/**
 * Patterns matching jest/vitest/mocha test commands.
 */
const JEST_PATTERN = /\b(jest|vitest|mocha|bun\s+test|bunx\s+vitest|npx\s+jest|npx\s+vitest|yarn\s+test|npm\s+test|pnpm\s+test)\b/i

/**
 * Patterns matching pytest commands.
 */
const PYTEST_PATTERN = /\b(pytest|python\s+-m\s+pytest|py\.test)\b/i

/**
 * Patterns matching eslint commands.
 */
const ESLINT_PATTERN = /\b(eslint|npx\s+eslint|yarn\s+eslint|pnpm\s+eslint)\b/i

/**
 * Patterns matching flake8/ruff commands.
 */
const FLAKE8_PATTERN = /\b(flake8|ruff(?:\s+check)?|python\s+-m\s+flake8)\b/i

/**
 * Patterns matching tsc commands.
 */
const TSC_PATTERN = /\b(tsc|npx\s+tsc|bunx\s+tsc|yarn\s+tsc|pnpm\s+tsc)\b/i

/**
 * Patterns matching mypy/pyright commands.
 */
const MYPY_PATTERN = /\b(mypy|pyright|python\s+-m\s+mypy|python\s+-m\s+pyright)\b/i

/**
 * Patterns matching go test commands.
 */
const GO_TEST_PATTERN = /\bgo\s+test\b/i

/**
 * Patterns matching cargo test commands.
 */
const CARGO_TEST_PATTERN = /\bcargo\s+test\b/i

/**
 * Route a tool_name to its parser.
 * Returns undefined if no parser matches (the tool call will still be
 * logged in tool_calls, just no structured facts extracted).
 */
export const route: ParserRouter = (toolName: string): Parser | undefined => {
  if (FILE_TOOLS.has(toolName)) {
    return parseFileEvent
  }
  // Bash tools require command inspection — handled by routeWithInput
  return undefined
}

/**
 * Extended router that also inspects tool_input.command for Bash commands.
 * Used by the record pipeline when full HookInput is available.
 */
export const routeWithInput = (input: HookInput): Parser | undefined => {
  // First try the simple tool_name match
  if (FILE_TOOLS.has(input.tool_name)) {
    return parseFileEvent
  }

  // For Bash tools, inspect the command
  if (input.tool_name === "Bash" || input.tool_name === "bash" || input.tool_name === "terminal" || input.tool_name === "execute_command") {
    const command = typeof input.tool_input?.command === "string"
      ? input.tool_input.command
      : typeof input.tool_input?.cmd === "string"
        ? input.tool_input.cmd
        : ""

    if (JEST_PATTERN.test(command)) {
      return parseJestOutput
    }
    if (PYTEST_PATTERN.test(command)) {
      return parsePytestOutput
    }
    if (GO_TEST_PATTERN.test(command)) {
      return parseGoOutput
    }
    if (CARGO_TEST_PATTERN.test(command)) {
      return parseCargoOutput
    }
    if (ESLINT_PATTERN.test(command)) {
      return parseEslintOutput
    }
    if (FLAKE8_PATTERN.test(command)) {
      return parseFlake8Output
    }
    if (TSC_PATTERN.test(command)) {
      return parseTscOutput
    }
    if (MYPY_PATTERN.test(command)) {
      return parseMypyOutput
    }
  }

  return undefined
}
