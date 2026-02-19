import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

type HookPayload = {
  hook: "PreToolUse" | "PostToolUse"
  tool_name: string
  tool_input: Record<string, unknown>
  tool_output?: string
  tool_exit_code?: number
}

type CommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
  timedOut: boolean
}

type LintApprove = {
  decision?: string
  additionalContext?: string
}

type LintDeny = {
  hookSpecificOutput?: {
    permissionDecision?: string
    permissionDecisionReason?: string
  }
}

const extensionDir = dirname(fileURLToPath(import.meta.url))
const localWitnessMain = resolve(extensionDir, "../src/main.ts")
const defaultEphemeralSessionId = `pi-ephemeral:${Date.now().toString(36)}:${Math.random()
  .toString(36)
  .slice(2, 10)}`

const LINT_TIMEOUT_MS = 750
const RECORD_TIMEOUT_MS = 1500
const INIT_TIMEOUT_MS = 3000

function getSessionId(ctx: { sessionManager: { getSessionFile(): string | undefined } }): string {
  return ctx.sessionManager.getSessionFile() ?? defaultEphemeralSessionId
}

function getWitnessCommand(subcommand: string): { command: string; args: string[] } {
  if (existsSync(localWitnessMain)) {
    return {
      command: "bun",
      args: ["run", localWitnessMain, subcommand],
    }
  }

  return {
    command: "witness",
    args: [subcommand],
  }
}

function parseLastJsonLine<T>(stdout: string): T | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]!) as T
    } catch {
      // continue
    }
  }

  return null
}

function contentToText(content: ReadonlyArray<{ type: string; text?: string }>): string | undefined {
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")

  return text.length > 0 ? text : undefined
}

function runWitness(
  subcommand: string,
  sessionId: string,
  payload?: HookPayload,
  timeoutMs: number = 1000
): Promise<CommandResult> {
  const { command, args } = getWitnessCommand(subcommand)

  return new Promise((resolvePromise) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const done = (result: CommandResult): void => {
      if (settled) return
      settled = true
      resolvePromise(result)
    }

    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WITNESS_SESSION: sessionId,
      },
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.on("error", (error) => {
      clearTimeout(timer)
      done({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        error: String(error),
        timedOut,
      })
    })

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.on("close", (exitCode) => {
      clearTimeout(timer)
      done({
        ok: exitCode === 0 && !timedOut,
        stdout,
        stderr,
        exitCode,
        timedOut,
      })
    })

    const input = payload ? JSON.stringify(payload) : ""
    child.stdin.end(input)
  })
}

export default function witnessExtension(pi: ExtensionAPI) {
  const initializedSessions = new Set<string>()
  let commandUnavailable = false
  let unavailableNotified = false

  const ensureInit = async (ctx: {
    hasUI: boolean
    ui: { notify(message: string, level: "info" | "warning" | "error"): void }
    sessionManager: { getSessionFile(): string | undefined }
  }): Promise<void> => {
    if (commandUnavailable) return

    const sessionId = getSessionId(ctx)
    if (initializedSessions.has(sessionId)) return

    const result = await runWitness("init", sessionId, undefined, INIT_TIMEOUT_MS)

    if (result.ok) {
      initializedSessions.add(sessionId)
      return
    }

    if (result.error?.includes("ENOENT")) {
      commandUnavailable = true
      if (ctx.hasUI && !unavailableNotified) {
        unavailableNotified = true
        ctx.ui.notify(
          "Witness extension disabled: could not find 'bun' or 'witness' command in PATH",
          "warning"
        )
      }
      return
    }

    if (ctx.hasUI) {
      ctx.ui.notify("Witness init failed; extension will keep trying on next session.", "warning")
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureInit(ctx)
  })

  pi.on("session_switch", async (_event, ctx) => {
    await ensureInit(ctx)
  })

  pi.on("tool_call", async (event, ctx) => {
    if (commandUnavailable) return

    const sessionId = getSessionId(ctx)

    const payload: HookPayload = {
      hook: "PreToolUse",
      tool_name: event.toolName,
      tool_input: event.input ?? {},
    }

    const result = await runWitness("lint", sessionId, payload, LINT_TIMEOUT_MS)
    if (!result.ok) return

    const lintResult = parseLastJsonLine<LintApprove & LintDeny>(result.stdout)
    if (!lintResult) return

    if (lintResult.hookSpecificOutput?.permissionDecision === "deny") {
      return {
        block: true,
        reason: lintResult.hookSpecificOutput.permissionDecisionReason ?? "Blocked by witness",
      }
    }

    if (lintResult.decision === "approve" && lintResult.additionalContext && ctx.hasUI) {
      ctx.ui.notify(lintResult.additionalContext, "warning")
    }

    return
  })

  pi.on("tool_result", async (event, ctx) => {
    if (commandUnavailable) return

    const sessionId = getSessionId(ctx)

    const payload: HookPayload = {
      hook: "PostToolUse",
      tool_name: event.toolName,
      tool_input: event.input ?? {},
      tool_output: contentToText(event.content as ReadonlyArray<{ type: string; text?: string }>),
      tool_exit_code: event.isError ? 1 : 0,
    }

    await runWitness("record", sessionId, payload, RECORD_TIMEOUT_MS)
  })
}
