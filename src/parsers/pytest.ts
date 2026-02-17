/**
 * Pytest test output parser.
 *
 * Tries JSON format first (pytest --json-report or pytest-json).
 * Falls back to text regex parsing (PASSED/FAILED patterns).
 *
 * Extracts: test name + outcome + failure message.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── JSON parsing ──────────────────────────────────────────────

interface PytestJsonTest {
  readonly nodeid?: string
  readonly outcome?: string
  readonly call?: {
    readonly outcome?: string
    readonly longrepr?: string
  }
}

interface PytestJsonOutput {
  readonly tests?: readonly PytestJsonTest[]
  readonly summary?: {
    readonly passed?: number
    readonly failed?: number
    readonly total?: number
  }
}

const parseJsonOutput = (raw: string): ReadonlyArray<Fact> | null => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== "object" || parsed === null) return null

    const data = parsed as PytestJsonOutput

    // Must have tests array
    if (!Array.isArray(data.tests)) return null

    const facts: Fact[] = []

    for (const test of data.tests) {
      const name = test.nodeid
      if (!name) continue

      const outcomeStr = test.outcome ?? test.call?.outcome
      if (!outcomeStr) continue

      let outcome: "pass" | "fail" | "skip"
      if (outcomeStr === "passed") outcome = "pass"
      else if (outcomeStr === "failed") outcome = "fail"
      else if (outcomeStr === "skipped") outcome = "skip"
      else continue

      const message =
        outcome === "fail" && test.call?.longrepr
          ? test.call.longrepr.slice(0, 500)
          : null

      facts.push(TestResult("", 0, name, outcome, message))
    }

    return facts.length > 0 ? facts : null
  } catch {
    return null
  }
}

// ── Text regex parsing ────────────────────────────────────────

// Match lines like: "tests/test_auth.py::test_login PASSED"
const RESULT_LINE = /^(\S+::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR)/

// Match short summary FAILED lines: "FAILED tests/test_auth.py::test_refresh_token"
const SUMMARY_FAIL_LINE = /^FAILED\s+(\S+::\S+)/

// Match failure header: "________________________________ test_name ________________________________"
const FAILURE_HEADER = /^_+\s+(\S+)\s+_+$/

// Match the summary line: "2 failed, 3 passed in 2.50s"
const SUMMARY_LINE = /(\d+)\s+failed.*(\d+)\s+passed/

const parseTextOutput = (raw: string): ReadonlyArray<Fact> => {
  const facts: Fact[] = []
  const lines = raw.split("\n")
  const failMessages = new Map<string, string>()

  // First pass: collect failure messages from FAILURES section
  let inFailures = false
  let currentFailTest: string | null = null
  let currentFailLines: string[] = []

  for (const line of lines) {
    if (line.includes("FAILURES") && line.includes("===")) {
      inFailures = true
      continue
    }
    if (inFailures && line.includes("===") && (line.includes("short test summary") || line.includes("passed") || line.includes("failed"))) {
      // Save last failure
      if (currentFailTest && currentFailLines.length > 0) {
        // Find the "E " line (pytest assertion error)
        const eLine = currentFailLines.find((l) => l.trimStart().startsWith("E "))
        if (eLine) {
          failMessages.set(currentFailTest, eLine.trimStart().slice(2).trim().slice(0, 500))
        }
      }
      inFailures = false
      continue
    }

    if (inFailures) {
      const headerMatch = line.match(FAILURE_HEADER)
      if (headerMatch) {
        // Save previous failure
        if (currentFailTest && currentFailLines.length > 0) {
          const eLine = currentFailLines.find((l) => l.trimStart().startsWith("E "))
          if (eLine) {
            failMessages.set(currentFailTest, eLine.trimStart().slice(2).trim().slice(0, 500))
          }
        }
        currentFailTest = headerMatch[1]!
        currentFailLines = []
      } else {
        currentFailLines.push(line)
      }
    }
  }

  // Save last failure block
  if (currentFailTest && currentFailLines.length > 0) {
    const eLine = currentFailLines.find((l) => l.trimStart().startsWith("E "))
    if (eLine) {
      failMessages.set(currentFailTest, eLine.trimStart().slice(2).trim().slice(0, 500))
    }
  }

  // Second pass: collect test results from inline lines
  for (const line of lines) {
    const match = line.match(RESULT_LINE)
    if (match) {
      const name = match[1]!
      const status = match[2]!

      let outcome: "pass" | "fail" | "skip"
      if (status === "PASSED") outcome = "pass"
      else if (status === "FAILED") outcome = "fail"
      else if (status === "SKIPPED") outcome = "skip"
      else if (status === "ERROR") outcome = "fail"
      else continue

      // Extract short test name for failure message lookup
      const shortName = name.split("::").pop() ?? name
      const message = failMessages.get(shortName) ?? null

      facts.push(TestResult("", 0, name, outcome, message))
    }
  }

  return facts
}

/**
 * Parse pytest tool output into TestResult facts.
 * Tries JSON first, falls back to text regex.
 * Never throws.
 */
export const parsePytestOutput = (input: HookInput): ReadonlyArray<Fact> => {
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
