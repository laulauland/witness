import { describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

describe("Init command", () => {
  test("creates DB file and directory", async () => {
    const dir = join(tmpdir(), `witness-test-${randomUUID()}`)
    const dbPath = join(dir, "test.db")

    try {
      const proc = Bun.spawn(["bun", "run", "src/main.ts", "init"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WITNESS_DB: dbPath },
      })
      const exitCode = await proc.exited
      const stdout = await new Response(proc.stdout).text()

      expect(exitCode).toBe(0)
      expect(existsSync(dbPath)).toBe(true)
      expect(stdout).toContain("initialized")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("init is idempotent — running twice succeeds", async () => {
    const dir = join(tmpdir(), `witness-test-${randomUUID()}`)
    const dbPath = join(dir, "test.db")

    try {
      // First init
      const proc1 = Bun.spawn(["bun", "run", "src/main.ts", "init"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WITNESS_DB: dbPath },
      })
      expect(await proc1.exited).toBe(0)

      // Second init — should not error
      const proc2 = Bun.spawn(["bun", "run", "src/main.ts", "init"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WITNESS_DB: dbPath },
      })
      expect(await proc2.exited).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("created DB has all expected tables", async () => {
    const dir = join(tmpdir(), `witness-test-${randomUUID()}`)
    const dbPath = join(dir, "test.db")

    try {
      const proc = Bun.spawn(["bun", "run", "src/main.ts", "init"], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WITNESS_DB: dbPath },
      })
      await proc.exited

      // Open the DB directly and check tables
      const { Database } = await import("bun:sqlite")
      const db = new Database(dbPath, { readonly: true })
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
      db.close()

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain("clock")
      expect(tableNames).toContain("tool_calls")
      expect(tableNames).toContain("file_events")
      expect(tableNames).toContain("test_results")
      expect(tableNames).toContain("lint_results")
      expect(tableNames).toContain("type_errors")
      expect(tableNames).toContain("imports")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
