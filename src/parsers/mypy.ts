/**
 * Mypy/Pyright output parser.
 *
 * Mypy format: file:line: error: message  [error-code]
 * Also: file:line: note: ...
 * Also: file:line:col: error: message  [error-code]
 *
 * Pyright format: file:line:col - error: message (rule)
 * Also:   file:line:col: error: message
 *
 * Extracts: file_path, line, message → TypeError facts.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TypeError, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── Text parsing ──────────────────────────────────────────────

// Mypy format: file.py:10: error: Incompatible types [assignment]
// With optional column: file.py:10:5: error: ...
const MYPY_LINE = /^(.+?):(\d+)(?::(\d+))?:\s*error:\s*(.+)$/

// Pyright format: file.py:10:5 - error: Incompatible types (reportGeneralTypeIssues)
const PYRIGHT_LINE = /^(.+?):(\d+):(\d+)\s*-\s*error:\s*(.+)$/

// Mypy note lines (skip these — they're context, not errors)
const NOTE_LINE = /:\s*note:\s*/

/**
 * Parse mypy/pyright tool output into TypeError facts.
 * Never throws.
 */
export const parseMypyOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const facts: Fact[] = []
    const lines = output.split("\n")

    for (const line of lines) {
      // Skip note lines
      if (NOTE_LINE.test(line)) continue

      // Try mypy format
      let match = line.match(MYPY_LINE)
      if (match) {
        const filePath = match[1]!
        const lineNum = parseInt(match[2]!, 10)
        let message = match[4]!.trim()
        // Strip trailing [error-code] but keep it in the message for context
        facts.push(TypeError("", 0, filePath, lineNum, message))
        continue
      }

      // Try pyright format
      match = line.match(PYRIGHT_LINE)
      if (match) {
        const filePath = match[1]!
        const lineNum = parseInt(match[2]!, 10)
        let message = match[4]!.trim()
        facts.push(TypeError("", 0, filePath, lineNum, message))
        continue
      }
    }

    return facts
  } catch {
    return []
  }
}
