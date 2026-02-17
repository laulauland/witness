/**
 * Cargo test output parser.
 *
 * Parses `cargo test` output, extracting test names (module::test_name),
 * outcomes (ok/FAILED/ignored), and failure messages from the failures section.
 *
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// ── Result line patterns ──────────────────────────────────────

// test math::tests::test_add ... ok
// test math::tests::test_add ... FAILED
// test math::tests::test_add ... ignored
// test src/lib.rs - add (line 5) ... ok  (doc-tests have spaces in name)
const RESULT_LINE = /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)/

// ── Failures section patterns ─────────────────────────────────

// ---- math::tests::test_multiply stdout ----
const FAILURE_HEADER = /^----\s+(\S+)\s+stdout\s+----$/

/**
 * Parse cargo test output into TestResult facts.
 * Never throws.
 */
export const parseCargoOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const lines = output.split("\n")
    const facts: Fact[] = []

    // First pass: collect failure messages from the "failures:" section
    const failMessages = new Map<string, string>()
    let currentFailTest: string | null = null
    let currentFailLines: string[] = []
    let inFailures = false

    for (const line of lines) {
      // Enter failures section
      if (line.trim() === "failures:" && !inFailures) {
        inFailures = true
        continue
      }

      // The second "failures:" block is the summary list — stop collecting messages
      if (inFailures && line.trim() === "failures:") {
        // Save last block
        if (currentFailTest && currentFailLines.length > 0) {
          failMessages.set(currentFailTest, currentFailLines.join("\n").slice(0, 500))
        }
        break
      }

      // "test result:" line ends the failures section too
      if (inFailures && line.trimStart().startsWith("test result:")) {
        if (currentFailTest && currentFailLines.length > 0) {
          failMessages.set(currentFailTest, currentFailLines.join("\n").slice(0, 500))
        }
        break
      }

      if (inFailures) {
        const headerMatch = line.match(FAILURE_HEADER)
        if (headerMatch) {
          // Save previous block
          if (currentFailTest && currentFailLines.length > 0) {
            failMessages.set(currentFailTest, currentFailLines.join("\n").slice(0, 500))
          }
          currentFailTest = headerMatch[1]!
          currentFailLines = []
        } else if (currentFailTest) {
          const trimmed = line.trim()
          if (trimmed.length > 0) {
            currentFailLines.push(trimmed)
          }
        }
      }
    }

    // Second pass: extract results from "test ... ok/FAILED/ignored" lines
    for (const line of lines) {
      const match = line.match(RESULT_LINE)
      if (!match) continue

      const testName = match[1]!
      const status = match[2]!

      let outcome: "pass" | "fail" | "skip"
      if (status === "ok") outcome = "pass"
      else if (status === "FAILED") outcome = "fail"
      else if (status === "ignored") outcome = "skip"
      else continue

      const message = outcome === "fail" ? (failMessages.get(testName) ?? null) : null

      facts.push(TestResult("", 0, testName, outcome, message))
    }

    return facts
  } catch {
    return []
  }
}
