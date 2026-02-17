/**
 * Tagged union types for all fact kinds stored in the witness DB.
 *
 * Each fact has:
 *   _tag — discriminator for the union
 *   session_id — UUID scoping facts to a session
 *   t — monotonic logical clock value (assigned at insert time)
 */

// ── File Events ───────────────────────────────────────────────

export type FileEventType = "read" | "edit" | "create" | "delete"

export interface FileEvent {
  readonly _tag: "FileEvent"
  readonly session_id: string
  readonly t: number
  readonly event: FileEventType
  readonly file_path: string
}

export const FileEvent = (
  session_id: string,
  t: number,
  event: FileEventType,
  file_path: string
): FileEvent => ({
  _tag: "FileEvent",
  session_id,
  t,
  event,
  file_path,
})

// ── Test Results ──────────────────────────────────────────────

export type TestOutcome = "pass" | "fail" | "skip" | "error"

export interface TestResult {
  readonly _tag: "TestResult"
  readonly session_id: string
  readonly t: number
  readonly test_name: string
  readonly outcome: TestOutcome
  readonly message: string | null
}

export const TestResult = (
  session_id: string,
  t: number,
  test_name: string,
  outcome: TestOutcome,
  message: string | null = null
): TestResult => ({
  _tag: "TestResult",
  session_id,
  t,
  test_name,
  outcome,
  message,
})

// ── Lint Results ──────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info"

export interface LintResult {
  readonly _tag: "LintResult"
  readonly session_id: string
  readonly t: number
  readonly file_path: string
  readonly line: number | null
  readonly rule: string
  readonly severity: LintSeverity
}

export const LintResult = (
  session_id: string,
  t: number,
  file_path: string,
  line: number | null,
  rule: string,
  severity: LintSeverity
): LintResult => ({
  _tag: "LintResult",
  session_id,
  t,
  file_path,
  line,
  rule,
  severity,
})

// ── Type Errors ───────────────────────────────────────────────

export interface TypeError {
  readonly _tag: "TypeError"
  readonly session_id: string
  readonly t: number
  readonly file_path: string
  readonly line: number | null
  readonly message: string
}

export const TypeError = (
  session_id: string,
  t: number,
  file_path: string,
  line: number | null,
  message: string
): TypeError => ({
  _tag: "TypeError",
  session_id,
  t,
  file_path,
  line,
  message,
})

// ── Imports ───────────────────────────────────────────────────

export interface Import {
  readonly _tag: "Import"
  readonly session_id: string
  readonly t: number
  readonly source_file: string
  readonly imported_module: string
}

export const Import = (
  session_id: string,
  t: number,
  source_file: string,
  imported_module: string
): Import => ({
  _tag: "Import",
  session_id,
  t,
  source_file,
  imported_module,
})

// ── Tool Calls ────────────────────────────────────────────────

export interface ToolCall {
  readonly _tag: "ToolCall"
  readonly session_id: string
  readonly t: number
  readonly tool_name: string
  readonly tool_input: string | null
  readonly tool_output: string | null
}

export const ToolCall = (
  session_id: string,
  t: number,
  tool_name: string,
  tool_input: string | null = null,
  tool_output: string | null = null
): ToolCall => ({
  _tag: "ToolCall",
  session_id,
  t,
  tool_name,
  tool_input,
  tool_output,
})

// ── Union ─────────────────────────────────────────────────────

export type Fact =
  | FileEvent
  | TestResult
  | LintResult
  | TypeError
  | Import
  | ToolCall

/**
 * Type guard for checking fact tags.
 */
export const isFact = (tag: Fact["_tag"]) => (fact: Fact): boolean =>
  fact._tag === tag
