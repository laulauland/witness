/**
 * Parser router: maps tool_name (+ optional command pattern) to the correct parser function.
 *
 * Phase 2: file parser (Edit/Write/Read)
 * Phase 4: jest/vitest + pytest parsers (Bash with matching commands)
 */
import type { Parser, ParserRouter, HookInput } from "./Parser.js"
import { parseFileEvent } from "./file.js"
import { parseJestOutput } from "./jest.js"
import { parsePytestOutput } from "./pytest.js"

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
  }

  return undefined
}
