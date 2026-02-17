import { Command } from "@effect/cli"
import { Console, Effect } from "effect"

export const LintCommand = Command.make("lint", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("witness: lint (stub)")
  })
).pipe(Command.withDescription("Evaluate lint rules against a PreToolUse hook (stdin JSON)"))
