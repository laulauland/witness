import { Command } from "@effect/cli"
import { Console, Effect } from "effect"

export const BriefingCommand = Command.make("briefing", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("witness: briefing (stub)")
  })
).pipe(Command.withDescription("Print a situational briefing summary"))
