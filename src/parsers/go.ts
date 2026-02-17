/**
 * Go test output parser.
 *
 * Handles both verbose (-v) output with === RUN / --- PASS/FAIL/SKIP lines
 * and summary-only output (just "ok" or "FAIL" package lines).
 *
 * Extracts: test name + outcome + failure message.
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── Verbose mode patterns ─────────────────────────────────────

// --- PASS: TestName (0.00s)
const PASS_LINE = /^---\s+PASS:\s+(\S+)\s+\(/

// --- FAIL: TestName (0.00s)
const FAIL_LINE = /^---\s+FAIL:\s+(\S+)\s+\(/

// --- SKIP: TestName (0.00s)
const SKIP_LINE = /^(?:\s+)?---\s+SKIP:\s+(\S+)\s+\(/

// Indented message line (go test indents with spaces/tabs + file:line:)
const MESSAGE_LINE = /^\s{4,}[\w\/._-]+\.go:\d+:/

/**
 * Parse go test verbose output into TestResult facts.
 * Never throws.
 */
export const parseGoOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const lines = output.split("\n")
    const facts: Fact[] = []

    // In go test verbose output, failure messages appear as indented lines
    // after the --- FAIL: line. We collect them in a second pass.
    //
    // Strategy: First pass collects fail messages by scanning after --- FAIL lines.
    // Second pass emits facts for all --- PASS/FAIL/SKIP lines.

    const failMessages = new Map<string, string>()

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const failMatch = line.match(FAIL_LINE)
      if (!failMatch) continue

      const testName = failMatch[1]!
      const msgLines: string[] = []

      // Collect indented lines following the --- FAIL line
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]!
        // Stop at next === RUN, --- PASS/FAIL/SKIP, FAIL, ok, or non-indented line
        if (
          nextLine.match(/^===\s+RUN/) ||
          nextLine.match(/^---\s+(PASS|FAIL|SKIP):/) ||
          nextLine.match(/^(PASS|FAIL|ok)\s/) ||
          nextLine === "PASS" ||
          nextLine === "FAIL"
        ) {
          break
        }
        const trimmed = nextLine.trim()
        if (trimmed.length > 0) {
          msgLines.push(trimmed)
        }
      }

      if (msgLines.length > 0) {
        failMessages.set(testName, msgLines.join("\n").slice(0, 500))
      }
    }

    // Emit facts for all result lines
    for (const line of lines) {
      let match = line.match(PASS_LINE)
      if (match) {
        facts.push(TestResult("", 0, match[1]!, "pass", null))
        continue
      }

      match = line.match(FAIL_LINE)
      if (match) {
        const testName = match[1]!
        const message = failMessages.get(testName) ?? null
        facts.push(TestResult("", 0, testName, "fail", message))
        continue
      }

      match = line.match(SKIP_LINE)
      if (match) {
        facts.push(TestResult("", 0, match[1]!, "skip", null))
        continue
      }
    }

    return facts
  } catch {
    return []
  }
}
