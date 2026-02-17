/**
 * File event parser.
 *
 * Extracts FileEvent facts from tool calls that manipulate files:
 *   Edit / str_replace_editor → FileEvent(edit, path)
 *   Write / file_create       → FileEvent(create, path)
 *   Read / view               → FileEvent(read, path)
 *
 * On Read events with tool_output containing file content, also extracts
 * Import facts by scanning for import statements in JS/TS, Python, Rust, Go.
 *
 * Never throws. Returns empty array on unrecognizable input.
 */
import { FileEvent, Import, type Fact } from "../Facts.js"
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

// ── Import extraction regexes ─────────────────────────────────
// Each regex captures the module specifier in group 1.

/** JS/TS: import ... from 'module', import('module'), require('module') */
// Static: import ... from 'module' (named, default, namespace, type imports)
const JS_IMPORT_FROM = /import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm
// Side-effect: import 'module' (no bindings, just bare string)
const JS_IMPORT_SIDEEFFECT = /import\s+['"]([^'"]+)['"]/gm
const JS_DYNAMIC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const JS_REQUIRE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Python: import X, from X import Y */
const PY_IMPORT = /^import\s+([\w.]+)/gm
const PY_FROM_IMPORT = /^from\s+([\w.]+)\s+import\b/gm

/** Rust: use X, mod X */
// Match `use path::to::module;` or `use path::to::{self, Item};`
// For grouped imports like `use std::io::{self, Read};`, capture the prefix `std::io`
// For simple imports like `use std::collections::HashMap;`, capture the full path
const RUST_USE_GROUPED = /^\s*use\s+([\w]+(?:::\w+)*)::\{[^}]*\}\s*;/gm
const RUST_USE_SIMPLE = /^\s*use\s+([\w]+(?:::\w+)*)\s*;/gm
const RUST_MOD = /^\s*mod\s+(\w+)\s*;/gm

/** Go: import "X", import (\n"X"\n"Y"\n) */
const GO_IMPORT_SINGLE = /import\s+"([^"]+)"/g
const GO_IMPORT_BLOCK = /import\s*\(([^)]*)\)/gs

/**
 * Determine file language from extension.
 */
type Language = "js" | "python" | "rust" | "go" | "unknown"

const getLanguage = (filePath: string): Language => {
  const ext = filePath.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
    case "mjs":
    case "cjs":
    case "mts":
    case "cts":
      return "js"
    case "py":
    case "pyi":
      return "python"
    case "rs":
      return "rust"
    case "go":
      return "go"
    default:
      return "unknown"
  }
}

/**
 * Collect all matches for a regex, returning the first capture group.
 */
const collectMatches = (regex: RegExp, text: string): string[] => {
  const results: string[] = []
  let match: RegExpExecArray | null
  // Reset lastIndex to ensure fresh matching
  regex.lastIndex = 0
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) results.push(match[1])
  }
  return results
}

/**
 * Extract imported module specifiers from file content.
 * Returns deduplicated list of import specifiers.
 */
export const extractImports = (filePath: string, content: string): string[] => {
  try {
    const lang = getLanguage(filePath)
    const imports = new Set<string>()

    switch (lang) {
      case "js": {
        for (const m of collectMatches(JS_IMPORT_FROM, content)) imports.add(m)
        for (const m of collectMatches(JS_IMPORT_SIDEEFFECT, content)) imports.add(m)
        for (const m of collectMatches(JS_DYNAMIC_IMPORT, content)) imports.add(m)
        for (const m of collectMatches(JS_REQUIRE, content)) imports.add(m)
        break
      }
      case "python": {
        for (const m of collectMatches(PY_IMPORT, content)) imports.add(m)
        for (const m of collectMatches(PY_FROM_IMPORT, content)) imports.add(m)
        break
      }
      case "rust": {
        for (const m of collectMatches(RUST_USE_GROUPED, content)) imports.add(m)
        for (const m of collectMatches(RUST_USE_SIMPLE, content)) imports.add(m)
        for (const m of collectMatches(RUST_MOD, content)) imports.add(m)
        break
      }
      case "go": {
        for (const m of collectMatches(GO_IMPORT_SINGLE, content)) imports.add(m)
        // Go block imports: import (\n  "fmt"\n  "os"\n)
        let blockMatch: RegExpExecArray | null
        GO_IMPORT_BLOCK.lastIndex = 0
        while ((blockMatch = GO_IMPORT_BLOCK.exec(content)) !== null) {
          const block = blockMatch[1]!
          const goQuoted = /["']([^"']+)["']/g
          let qm: RegExpExecArray | null
          while ((qm = goQuoted.exec(block)) !== null) {
            if (qm[1]) imports.add(qm[1])
          }
        }
        break
      }
      default:
        // Unknown language — no imports extracted
        break
    }

    return [...imports]
  } catch {
    return []
  }
}

/**
 * Parse a tool call into FileEvent facts.
 * On Read events with tool_output, also extracts Import facts.
 * Returns 0+ facts as an array.
 */
export const parseFileEvent = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const event = toolToEvent[input.tool_name]
    if (!event) return []

    const path = extractPath(input.tool_input ?? {})
    if (!path) return []

    const facts: Fact[] = []

    // Use placeholder session_id and t — will be assigned at insert time
    facts.push(FileEvent("", 0, event, path))

    // On Read events, extract imports from tool_output
    if (event === "read" && typeof input.tool_output === "string" && input.tool_output.length > 0) {
      const imports = extractImports(path, input.tool_output)
      for (const mod of imports) {
        facts.push(Import("", 0, path, mod))
      }
    }

    return facts
  } catch {
    return []
  }
}
