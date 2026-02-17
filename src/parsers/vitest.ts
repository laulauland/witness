/**
 * Vitest test output parser.
 *
 * Vitest JSON reporter output shares structure with Jest's JSON format
 * (testResults → assertionResults with fullName/status/failureMessages)
 * but vitest also supports its own text format with ✓/✗ markers and
 * → error arrows.
 *
 * The jest parser already handles the shared JSON shape. This parser
 * adds vitest-specific text handling and is wired separately in the
 * router so it can evolve independently.
 *
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing ──────────────────────────────────────────────
// Vitest JSON reporter matches Jest's schema:
// { testResults: [{ assertionResults: [{ fullName, status, failureMessages }] }] }

interface VitestAssertionResult {
  readonly fullName?: string
  readonly ancestorTitles?: readonly string[]
  readonly title?: string
  readonly status?: string
  readonly duration?: number
  readonly failureMessages?: readonly string[]
}

interface VitestTestResult {
  readonly name?: string
  readonly status?: string
  readonly assertionResults?: readonly VitestAssertionResult[]
}

interface VitestJsonOutput {
  readonly numTotalTests?: number
  readonly numPassedTests?: number
  readonly numFailedTests?: number
  readonly numSkippedTests?: number
  readonly testResults?: readonly VitestTestResult[]
  readonly success?: boolean
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return null

    const data = parsed as VitestJsonOutput
    if (!Array.isArray(data.testResults)) return null

    const facts: Fact[] = []

    for (const suite of data.testResults) {
      if (!Array.isArray(suite.assertionResults)) continue
      for (const assertion of suite.assertionResults) {
        const name = assertion.fullName
          ?? [
            ...(assertion.ancestorTitles ?? []),
            assertion.title ?? "unknown",
          ].join(" > ")

        const status = assertion.status
        if (!status) continue

        let outcome: "pass" | "fail" | "skip"
        if (status === "passed") outcome = "pass"
        else if (status === "failed") outcome = "fail"
        else if (status === "pending" || status === "skipped" || status === "todo") outcome = "skip"
        else continue

        const message =
          outcome === "fail" && Array.isArray(assertion.failureMessages) && assertion.failureMessages.length > 0
            ? assertion.failureMessages[0]!.slice(0, 500)
            : null

        facts.push(TestResult("", 0, name, outcome, message))
      }
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text parsing ──────────────────────────────────────────────
// Vitest text output:
//   ✓ test name
//   ✗ test name
//     → Error: message

const CHECKMARK_PASS = /[✓✔]\s+(.+?)(?:\s+\(\d+\s*m?s\)\s*)?$/
const CHECKMARK_FAIL = /[✗✘×]\s+(.+?)(?:\s+\(\d+\s*m?s\)\s*)?$/
const SKIP_LINE = /[○◌⊘]\s+(?:skipped\s+)?(.+?)$/
const VITEST_ERROR = /^\s+→\s+(.+)$/

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    let match = line.match(CHECKMARK_PASS)
    if (match) {
      facts.push(TestResult("", 0, match[1]!.trim(), "pass", null))
      continue
    }

    match = line.match(CHECKMARK_FAIL)
    if (match) {
      const name = match[1]!.trim()
      let message: string | null = null
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]!
        const errMatch = nextLine.match(VITEST_ERROR)
        if (errMatch) {
          message = errMatch[1]!.trim().slice(0, 500)
        }
      }
      facts.push(TestResult("", 0, name, "fail", message))
      continue
    }

    match = line.match(SKIP_LINE)
    if (match) {
      facts.push(TestResult("", 0, match[1]!.trim(), "skip", null))
      continue
    }
  }

  return facts
}

/**
 * Parse vitest tool output into TestResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parseVitestOutput = (input: HookInput): ReadonlyArray<Fact> => {
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
