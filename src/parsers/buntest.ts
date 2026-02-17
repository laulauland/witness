/**
 * Bun test output parser.
 *
 * Bun test uses a distinctive output format:
 *   (pass) Description > test name [duration]
 *   (fail) Description > test name [duration]
 *         error: message
 *
 * Summary line: "N pass\nM fail"
 *
 * Never throws. Returns empty array on unrecognizable input.
 */
import { TestResult, type Fact } from "../Facts.js"
import type { HookInput } from "./Parser.js"

// Match (pass) and (fail) lines
// e.g. "(pass) Auth > should validate token [2.15ms]"
// e.g. "(fail) Auth > should refresh expired token [5.23ms]"
const PASS_LINE = /^\(pass\)\s+(.+?)(?:\s+\[\d+[\d.]*\s*m?s\])?\s*$/
const FAIL_LINE = /^\(fail\)\s+(.+?)(?:\s+\[\d+[\d.]*\s*m?s\])?\s*$/

// Error message follows a (fail) line, indented with "error:" or "Error:"
const ERROR_LINE = /^\s+error:\s+(.+)$/i
// Also catch "TypeError:", "AssertionError:", etc.
const TYPED_ERROR_LINE = /^\s+(\w*(?:Error|Exception):\s+.+)$/

/**
 * Parse bun test tool output into TestResult facts.
 * Never throws.
 */
export const parseBunTestOutput = (input: HookInput): ReadonlyArray<Fact> => {
  try {
    const output = input.tool_output ?? ""
    if (output.length === 0) return []

    const facts: Fact[] = []
    const lines = output.split("\n")

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!

      // (pass) lines
      const passMatch = line.match(PASS_LINE)
      if (passMatch) {
        facts.push(TestResult("", 0, passMatch[1]!.trim(), "pass", null))
        continue
      }

      // (fail) lines
      const failMatch = line.match(FAIL_LINE)
      if (failMatch) {
        const name = failMatch[1]!.trim()

        // Look ahead for error message (up to 5 lines)
        let message: string | null = null
        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
          const nextLine = lines[j]!

          // Blank or next test result — stop looking
          if (nextLine.trim() === "" || PASS_LINE.test(nextLine) || FAIL_LINE.test(nextLine)) {
            break
          }

          const errorMatch = nextLine.match(ERROR_LINE)
          if (errorMatch) {
            message = errorMatch[1]!.trim().slice(0, 500)
            break
          }

          const typedMatch = nextLine.match(TYPED_ERROR_LINE)
          if (typedMatch) {
            message = typedMatch[1]!.trim().slice(0, 500)
            break
          }
        }

        facts.push(TestResult("", 0, name, "fail", message))
        continue
      }
    }

    return facts
  } catch {
    return []
  }
}
