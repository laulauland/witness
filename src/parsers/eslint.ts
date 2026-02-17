/**
 * ESLint output parser.
 *
 * Handles two formats:
 * 1. JSON format (-f json): Array of { filePath, messages: [{ line, column, ruleId, severity, message }] }
 * 2. Default text format: "file:line:col  severity  message  ruleId"
 *
 * Extracts: file_path, line, rule, severity, message → LintResult facts.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { LintResult, type Fact, type LintSeverity } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing ──────────────────────────────────────────────

interface EslintMessage {
  readonly line?: number
  readonly column?: number
  readonly ruleId?: string | null
  readonly severity?: number
  readonly message?: string
}

interface EslintFileResult {
  readonly filePath?: string
  readonly messages?: readonly EslintMessage[]
  readonly errorCount?: number
  readonly warningCount?: number
}

const severityFromNumber = (sev: number): LintSeverity => {
  if (sev === 2) return "error"
  if (sev === 1) return "warning"
  return "info"
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const trimmed = raw.trim()
    // ESLint JSON output is an array
    if (!trimmed.startsWith("[")) return null

    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return null

    const data = parsed as readonly EslintFileResult[]
    const facts: Fact[] = []

    for (const fileResult of data) {
      const filePath = fileResult.filePath
      if (!filePath || typeof filePath !== "string") continue

      if (!Array.isArray(fileResult.messages)) continue

      for (const msg of fileResult.messages) {
        const ruleId = msg.ruleId ?? "unknown"
        const line = typeof msg.line === "number" ? msg.line : null
        const severity = typeof msg.severity === "number"
          ? severityFromNumber(msg.severity)
          : "error"

        facts.push(LintResult("", 0, filePath, line, ruleId, severity))
      }
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text parsing ──────────────────────────────────────────────

// ESLint default formatter outputs like:
//   /path/to/file.js
//     10:5  error  Unexpected console statement  no-console
//     15:1  warning  Missing semicolon  semi
//
// Also handles stylish formatter (same format)
const FILE_HEADER = /^(\/\S+|[A-Za-z]:\\\S+|\S+\.\w+)$/
const LINT_LINE = /^\s+(\d+):(\d+)\s+(error|warning|warn)\s+(.+?)\s{2,}(\S+)\s*$/

// Also handle compact format: file:line:col: message (rule)
const COMPACT_LINE = /^(.+?):(\d+):(\d+):\s+(error|warning|Error|Warning)\s+(.+?)(?:\s+\(([^)]+)\))?$/

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")
  let currentFile: string | null = null

  for (const line of lines) {
    // Try stylish/default format
    const headerMatch = line.match(FILE_HEADER)
    if (headerMatch && !line.includes("  ")) {
      currentFile = headerMatch[1]!
      continue
    }

    if (currentFile) {
      const lintMatch = line.match(LINT_LINE)
      if (lintMatch) {
        const lineNum = parseInt(lintMatch[1]!, 10)
        const sevStr = lintMatch[3]!
        const message = lintMatch[4]!.trim()
        const rule = lintMatch[5]!

        const severity: LintSeverity = sevStr === "error" ? "error" : "warning"
        facts.push(LintResult("", 0, currentFile, lineNum, rule, severity))
        continue
      }
    }

    // Try compact format: file:line:col: severity message (rule)
    const compactMatch = line.match(COMPACT_LINE)
    if (compactMatch) {
      const filePath = compactMatch[1]!
      const lineNum = parseInt(compactMatch[2]!, 10)
      const sevStr = compactMatch[4]!.toLowerCase()
      const rule = compactMatch[6] ?? "unknown"

      const severity: LintSeverity = sevStr === "error" ? "error" : "warning"
      facts.push(LintResult("", 0, filePath, lineNum, rule, severity))
      continue
    }

    // Reset currentFile if we see an empty line (section separator)
    if (line.trim() === "") {
      // Don't reset — ESLint may have blank lines within a file block
    }
  }

  return facts
}

/**
 * Parse eslint tool output into LintResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parseEslintOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    // Try JSON first
    const jsonResult = parseJsonOutput(output)
    if (jsonResult !== null) return jsonResult

    // Fallback to text parsing
    return parseTextOutput(output)
  } catch {
    return []
  }
}
