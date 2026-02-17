/**
 * File event parser.
 *
 * Extracts FileEvent facts from tool calls that manipulate files:
 *   Edit / str_replace_editor → FileEvent(edit, path)
 *   Write / file_create       → FileEvent(create, path)
 *   Read / view               → FileEvent(read, path)
 *
 * Never throws. Returns empty array on unrecognizable input.
 */
import { FileEvent, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

/**
 * Extract the file path from tool_input.
 * Handles various field names agents use: path, file_path, file, filename.
 */
const extractPath = (toolInput: Record<string, unknown>): string | undefined => {
  const candidates = ["path", "file_path", "file", "filename"]
  for (const key of candidates) {
    const val = toolInput[key]
    if (typeof val === "string" && val.length > 0) {
      return val
    }
  }
  return undefined
}

type EventType = "read" | "edit" | "create"

/**
 * Map tool_name to the file event type.
 */
const toolToEvent: Record<string, EventType> = {
  // Edit tools
  Edit: "edit",
  edit: "edit",
  str_replace_editor: "edit",
  // Write/create tools
  Write: "create",
  write: "create",
  file_create: "create",
  create_file: "create",
  // Read/view tools
  Read: "read",
  read: "read",
  view: "read",
  cat: "read",
}

/**
 * Parse a tool call into FileEvent facts.
 * Returns 0 or 1 FileEvent (always as an array for consistency).
 */
export const parseFileEvent = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const event = toolToEvent[input.tool_name]
    if (!event) return []

    const path = extractPath(input.tool_input ?? {})
    if (!path) return []

    // Use placeholder session_id and t — will be assigned at insert time
    return [FileEvent("", 0, event, path)]
  } catch {
    return []
  }
}
