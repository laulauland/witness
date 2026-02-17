import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"

import { BriefingCommand } from "./commands/Briefing.js"
import { InitCommand } from "./commands/Init.js"
import { LintCommand } from "./commands/Lint.js"
import { QueryCommand } from "./commands/Query.js"
import { RecordCommand } from "./commands/Record.js"

const command = Command.make("witness").pipe(
  Command.withDescription("Behavioral linter for AI coding agents"),
  Command.withSubcommands([
    InitCommand,
    RecordCommand,
    LintCommand,
    BriefingCommand,
    QueryCommand,
  ])
)

const cli = Command.run(command, {
  name: "witness",
  version: "0.0.1",
})

cli(process.argv).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
