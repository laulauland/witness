/**
 * Parser types for extracting structured facts from tool call data.
 *
 * A Parser takes raw tool call info and returns an array of Facts.
 * A ParserRouter maps tool_name (+ optional command) to the correct parser.
 */
import type { Fact } from "../Facts.js"

/**
 * The shape of a PostToolUse hook input from the agent.
 */
export interface HookInput {
  readonly hook?: string
  readonly tool_name: string
  readonly tool_input: Record<string, unknown>
  readonly tool_output?: string
  readonly tool_exit_code?: number
}

/**
 * A parser function: extracts structured facts from a tool call.
 * Never throws — returns empty array if it can't parse.
 */
export type Parser = (input: HookInput) => ReadonlyArray<Fact>

/**
 * A parser router: given a tool_name, returns the matching parser (or undefined).
 */
export type ParserRouter = (toolName: string) => Parser | undefined
