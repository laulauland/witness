import { describe, expect, test } from "bun:test"

describe("witness CLI", () => {
  test("--help prints all subcommands", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(text).toContain("init")
    expect(text).toContain("record")
    expect(text).toContain("lint")
    expect(text).toContain("briefing")
    expect(text).toContain("query")
  })

  test("init subcommand runs without error", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "init"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })

  test("record subcommand runs without error", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "record"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })

  test("lint subcommand runs without error", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "lint"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })

  test("briefing subcommand runs without error", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "briefing"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)
  })

  test("query subcommand requires a name argument", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "query"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    // Should fail because no argument provided
    expect(exitCode).not.toBe(0)
  })

  test("query subcommand runs with a name argument", async () => {
    const proc = Bun.spawn(["bun", "run", "src/main.ts", "query", "failing"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(text).toContain("failing")
  })
})
