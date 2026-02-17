import { Command } from "@effect/cli"
import { Console, Effect } from "effect"

export const InitCommand = Command.make("init", {}, () =>
  Effect.gen(function* () {
    yield* Console.log("witness: init (stub)")
  })
).pipe(Command.withDescription("Create the witness database and schema"))
