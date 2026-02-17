import { Command } from "@effect/cli"
import { Console, Effect } from "effect"

export const RecordCommand = Command.make("record", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("witness: record (stub)")
  })
).pipe(Command.withDescription("Record a tool call from PostToolUse hook (stdin JSON)"))
