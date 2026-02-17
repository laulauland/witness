/**
 * Flake8/Ruff output parser.
 *
 * Standard format: file:line:col: CODE message
 * Also handles ruff's format: file:line:col: CODE message
 * And ruff check with JSON output.
 *
 * Extracts: file_path, line, rule (error code), severity → LintResult facts.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { LintResult, type Fact, type LintSeverity } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing (ruff --output-format json) ──────────────────

interface RuffJsonDiagnostic {
  readonly code?: string | null
  readonly filename?: string
  readonly location?: { readonly row?: number; readonly column?: number }
  readonly message?: string
  readonly noqa_row?: number
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("[")) return null

    const parsed = JSON.parse(trimmed) as unknown
    if (!Array.isArray(parsed)) return null

    const data = parsed as readonly RuffJsonDiagnostic[]
    // Verify it looks like ruff/flake8 JSON
    if (data.length > 0 && !data[0]?.filename && !data[0]?.code) return null

    const facts: Fact[] = []

    for (const diag of data) {
      const filePath = diag.filename
      if (!filePath || typeof filePath !== "string") continue

      const code = diag.code ?? "unknown"
      const line = diag.location?.row ?? null

      const severity = severityFromCode(code)
      facts.push(LintResult("", 0, filePath, line, code, severity))
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text parsing ──────────────────────────────────────────────

// Standard format: file.py:10:5: E302 expected 2 blank lines, got 1
// Also: file.py:10:5: W291 trailing whitespace
const FLAKE8_LINE = /^(.+?):(\d+):(\d+):\s+([A-Z]\w*\d+)\s+(.+)$/

/**
 * Infer severity from error code prefix.
 * E = error, W = warning, F/C/N/etc. = varies but generally warning/info.
 */
const severityFromCode = (code: string): LintSeverity => {
  if (code.startsWith("E") || code.startsWith("F")) return "error"
  if (code.startsWith("W")) return "warning"
  return "warning"
}

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")

  for (const line of lines) {
    const match = line.match(FLAKE8_LINE)
    if (match) {
      const filePath = match[1]!
      const lineNum = parseInt(match[2]!, 10)
      const code = match[4]!
      const severity = severityFromCode(code)

      facts.push(LintResult("", 0, filePath, lineNum, code, severity))
    }
  }

  return facts
}

/**
 * Parse flake8/ruff tool output into LintResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parseFlake8Output = (input: HookInput): ReadonlyArray<Fact> => {
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
