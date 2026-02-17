/**
 * Biome linter output parser.
 *
 * Handles two formats:
 * 1. JSON format (--formatter=json / --reporter=json):
 *    { diagnostics: [{ category, severity, location: { path: { file }, ... }, ... }] }
 * 2. Default text format:
 *    file:line:col category ━━━━
 *      ✖ message
 *
 * Extracts: file_path, line, rule (category), severity → LintResult facts.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { LintResult, type Fact, type LintSeverity } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing ──────────────────────────────────────────────

interface BiomeDiagnosticLocation {
  readonly path?: { readonly file?: string }
  readonly span?: readonly number[]
  readonly sourceCode?: string
}

interface BiomeDiagnostic {
  readonly category?: string
  readonly severity?: string
  readonly description?: string
  readonly message?: readonly { readonly content?: string }[]
  readonly location?: BiomeDiagnosticLocation
  readonly tags?: readonly string[]
}

interface BiomeJsonOutput {
  readonly diagnostics?: readonly BiomeDiagnostic[]
  readonly command?: string
}

const mapSeverity = (sev: string | undefined): LintSeverity => {
  if (sev === "warning" || sev === "warn") return "warning"
  if (sev === "info" || sev === "information") return "info"
  return "error"
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("{")) return null

    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed !== "object" || parsed === null) return null

    const data = parsed as BiomeJsonOutput
    if (!Array.isArray(data.diagnostics)) return null

    const facts: Fact[] = []

    for (const diag of data.diagnostics) {
      const filePath = diag.location?.path?.file
      if (!filePath || typeof filePath !== "string") continue

      const rule = diag.category ?? "unknown"
      const severity = mapSeverity(diag.severity)

      // Biome uses byte spans, not line numbers in JSON.
      // We set line to null since we can't reliably convert without source.
      facts.push(LintResult("", 0, filePath, null, rule, severity))
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text parsing ──────────────────────────────────────────────

// Biome text output header line:
// src/auth.ts:10:3 lint/suspicious/noConsoleLog ━━━━━━━━━━
const DIAGNOSTIC_HEADER = /^(\S+):(\d+):(\d+)\s+([\w/]+)\s+━/

// Also match lines without the bar decoration (compact/CI mode):
// src/auth.ts:10:3 lint/suspicious/noConsoleLog
const DIAGNOSTIC_HEADER_COMPACT = /^(\S+):(\d+):(\d+)\s+((?:lint|format|assist|organize_imports)\/[\w/]+)\s*$/

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")

  for (const line of lines) {
    let match = line.match(DIAGNOSTIC_HEADER)
    if (!match) {
      match = line.match(DIAGNOSTIC_HEADER_COMPACT)
    }
    if (match) {
      const filePath = match[1]!
      const lineNum = parseInt(match[2]!, 10)
      const rule = match[4]!

      // Biome doesn't put severity in text output; all reported diagnostics
      // are errors by default (warnings are suppressed unless --diagnostic-level=warn)
      facts.push(LintResult("", 0, filePath, lineNum, rule, "error"))
    }
  }

  return facts
}

/**
 * Parse biome tool output into LintResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parseBiomeOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const jsonResult = parseJsonOutput(output)
    if (jsonResult !== null) return jsonResult

    return parseTextOutput(output)
  } catch {
    return []
  }
}
