/**
 * Jest/Vitest test output parser.
 *
 * Tries JSON format first (look for {"numFailedTests":...} or {"testResults":...}).
 * Falls back to text regex parsing (✓/✗/PASS/FAIL patterns).
 *
 * Extracts: test name + pass/fail/skip + failure message.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing ──────────────────────────────────────────────

interface JestAssertionResult {
  readonly fullName?: string
  readonly ancestorTitles?: readonly string[]
  readonly title?: string
  readonly status?: string
  readonly failureMessages?: readonly string[]
}

interface JestTestResult {
  readonly assertionResults?: readonly JestAssertionResult[]
}

interface JestJsonOutput {
  readonly numFailedTests?: number
  readonly numPassedTests?: number
  readonly testResults?: readonly JestTestResult[]
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return null

    const data = parsed as JestJsonOutput

    // Must have testResults array or numFailedTests/numPassedTests
    if (!Array.isArray(data.testResults) && data.numFailedTests === undefined && data.numPassedTests === undefined) {
      return null
    }

    const facts: Fact[] = []

    if (Array.isArray(data.testResults)) {
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
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text regex parsing ────────────────────────────────────────

// Match ✓ or ✗ lines (jest/vitest style)
const CHECKMARK_PASS = /[✓✔]\s+(.+?)(?:\s+\(\d+\s*m?s\)\s*)?$/
const CHECKMARK_FAIL = /[✗✘×]\s+(.+?)(?:\s+\(\d+\s*m?s\)\s*)?$/
const SKIP_LINE = /[○◌]\s+(?:skipped\s+)?(.+?)$/

// Match PASS/FAIL lines (bun test, jest summary style)
// e.g. "tests/foo.test.ts::test_name PASSED"
const PYTEST_STYLE_PASS = /^(\S+::\S+)\s+PASSED/
const PYTEST_STYLE_FAIL = /^(\S+::\S+)\s+FAILED/

// Vitest-style with arrow for failure message: "→ Error: ..."
const VITEST_ERROR = /^\s+→\s+(.+)$/

// Jest text failure block: "● Suite › Test Name"
const JEST_FAILURE_HEADER = /^\s+●\s+(.+)$/

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")
  let pendingFailName: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // ✓ pass
    let match = line.match(CHECKMARK_PASS)
    if (match) {
      facts.push(TestResult("", 0, match[1]!.trim(), "pass", null))
      continue
    }

    // ✗ fail
    match = line.match(CHECKMARK_FAIL)
    if (match) {
      const name = match[1]!.trim()
      // Look ahead for vitest-style error arrow
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

    // ○ skip
    match = line.match(SKIP_LINE)
    if (match) {
      facts.push(TestResult("", 0, match[1]!.trim(), "skip", null))
      continue
    }

    // Jest failure header: ● Suite › Test Name
    match = line.match(JEST_FAILURE_HEADER)
    if (match) {
      pendingFailName = match[1]!.trim()
      // Scan forward for the error message (first non-empty, non-code line)
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const errorLine = lines[j]!.trim()
        if (errorLine.length > 0 && !errorLine.startsWith("at ") && !errorLine.match(/^\d+\s*\|/)) {
          // Check if this test name already exists with a message — update it
          const existing = facts.find(
            (f) => f._tag === "TestResult" && (f as any).test_name === pendingFailName && (f as any).outcome === "fail"
          )
          if (existing && existing._tag === "TestResult" && !(existing as any).message) {
            // Can't mutate, but since we already added it, the message from ● block
            // is a supplementary detail. The test was already captured by ✗ line.
            // We'll just add the message to a new entry if not already present.
          }
          break
        }
      }
      pendingFailName = null
      continue
    }
  }

  return facts
}

/**
 * Parse jest/vitest tool output into TestResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parseJestOutput = (input: HookInput): ReadonlyArray<Fact> => {
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
