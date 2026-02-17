/**
 * TypeScript compiler (tsc) error parser.
 *
 * Format: file(line,col): error TSxxxx: message
 * Also handles: file:line:col - error TSxxxx: message (some formatters)
 * And multi-line errors where continuation lines are indented.
 *
 * Extracts: file_path, line, message → TypeError facts.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TypeError, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── Text parsing ──────────────────────────────────────────────

// Standard tsc format: src/foo.ts(10,5): error TS2345: Argument of type 'string'...
const TSC_PAREN = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/

// Alternative format with colon separators: src/foo.ts:10:5 - error TS2345: Argument...
const TSC_COLON = /^(.+?):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)$/

/**
 * Parse tsc tool output into TypeError facts.
 * Never throws.
 */
export const parseTscOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const facts: Fact[] = []
    const lines = output.split("\n")

    for (const line of lines) {
      // Try standard paren format
      let match = line.match(TSC_PAREN)
      if (match) {
        const filePath = match[1]!
        const lineNum = parseInt(match[2]!, 10)
        const code = match[4]!
        const message = `${code}: ${match[5]!}`

        facts.push(TypeError("", 0, filePath, lineNum, message))
        continue
      }

      // Try colon format
      match = line.match(TSC_COLON)
      if (match) {
        const filePath = match[1]!
        const lineNum = parseInt(match[2]!, 10)
        const code = match[4]!
        const message = `${code}: ${match[5]!}`

        facts.push(TypeError("", 0, filePath, lineNum, message))
        continue
      }
    }

    return facts
  } catch {
    return []
  }
}
