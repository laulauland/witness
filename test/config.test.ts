import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig, DEFAULT_CONFIG, getRuleConfig } from "../src/Config.js"

describe("Config loading", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `witness-test-config-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("returns defaults when no config file exists", () => {
    const config = loadConfig(tempDir)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  test("loads simple rule actions from .witness.json", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_edit_unread: "block",
          test_after_edits: "off",
        },
      })
    )

    const config = loadConfig(tempDir)
    expect(config.rules.no_edit_unread?.action).toBe("block")
    expect(config.rules.test_after_edits?.action).toBe("off")
    // Defaults preserved for unspecified rules
    expect(config.rules.no_commit_failing?.action).toBe("off")
  })

  test("loads rule actions with options", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          test_after_edits: ["warn", { threshold: 5 }],
        },
      })
    )

    const config = loadConfig(tempDir)
    expect(config.rules.test_after_edits?.action).toBe("warn")
    expect(config.rules.test_after_edits?.options.threshold).toBe(5)
  })

  test("merges options with defaults", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          test_after_edits: ["block", { threshold: 10 }],
        },
      })
    )

    const config = loadConfig(tempDir)
    expect(config.rules.test_after_edits?.action).toBe("block")
    expect(config.rules.test_after_edits?.options.threshold).toBe(10)
  })

  test("ignores invalid rule actions", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_edit_unread: "invalid_action",
          test_after_edits: 42,
        },
      })
    )

    const config = loadConfig(tempDir)
    // Invalid entries keep defaults
    expect(config.rules.no_edit_unread?.action).toBe("off")
    expect(config.rules.test_after_edits?.action).toBe("off")
  })

  test("returns defaults for malformed JSON", () => {
    writeFileSync(join(tempDir, ".witness.json"), "not json at all")

    const config = loadConfig(tempDir)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  test("returns defaults for JSON without rules key", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({ something: "else" })
    )

    const config = loadConfig(tempDir)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  test("getRuleConfig returns config for known rule", () => {
    const config = DEFAULT_CONFIG
    const rc = getRuleConfig(config, "no_edit_unread")
    expect(rc.action).toBe("off")
  })

  test("getRuleConfig returns off for unknown rule", () => {
    const config = DEFAULT_CONFIG
    const rc = getRuleConfig(config, "nonexistent_rule")
    expect(rc.action).toBe("off")
  })

  test("default config has all 7 rules", () => {
    const ruleNames = Object.keys(DEFAULT_CONFIG.rules)
    expect(ruleNames).toContain("no_edit_unread")
    expect(ruleNames).toContain("fix_regressions_first")
    expect(ruleNames).toContain("test_after_edits")
    expect(ruleNames).toContain("no_thrashing")
    expect(ruleNames).toContain("no_commit_failing")
    expect(ruleNames).toContain("no_pointless_rerun")
    expect(ruleNames).toContain("scope_check")
    expect(ruleNames).toHaveLength(7)
  })

  test("default test_after_edits threshold is 3", () => {
    expect(DEFAULT_CONFIG.rules.test_after_edits?.options.threshold).toBe(3)
  })

  test("default no_thrashing threshold is 3", () => {
    expect(DEFAULT_CONFIG.rules.no_thrashing?.options.threshold).toBe(3)
  })

  test("handles tuple with empty options object", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_edit_unread: ["block", {}],
        },
      })
    )

    const config = loadConfig(tempDir)
    expect(config.rules.no_edit_unread?.action).toBe("block")
  })

  test("handles tuple with only action (no options)", () => {
    writeFileSync(
      join(tempDir, ".witness.json"),
      JSON.stringify({
        rules: {
          no_edit_unread: ["block"],
        },
      })
    )

    const config = loadConfig(tempDir)
    expect(config.rules.no_edit_unread?.action).toBe("block")
  })
})
