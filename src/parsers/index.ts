/**
 * Parser router: maps tool_name to the correct parser function.
 *
 * Only the file parser is implemented in Phase 2.
 * Test/lint parsers will be added in Phase 4+.
 */
import type { Parser, ParserRouter } from "./Parser.js"
import { parseFileEvent } from "./file.js"

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
 * Route a tool_name to its parser.
 * Returns undefined if no parser matches (the tool call will still be
 * logged in tool_calls, just no structured facts extracted).
 */
export const route: ParserRouter = (toolName: string): Parser | undefined => {
  if (FILE_TOOLS.has(toolName)) {
    return parseFileEvent
  }
  return undefined
}
