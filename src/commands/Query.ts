import { Args, Command } from "@effect/cli"
import { Console, Effect } from "effect"

const queryName = Args.text({ name: "name" }).pipe(
  Args.withDescription("Named query to run (failing, regressions, thrashing, etc.)")
)

export const QueryCommand = Command.make("query", { queryName }, ({ queryName }) =>
  Effect.gen(function* () {
    yield* Console.log(`witness: query ${queryName} (stub)`)
  })
).pipe(Command.withDescription("Run a named query against the witness database"))
