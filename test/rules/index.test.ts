import { describe, expect, test } from "bun:test"
import { allRules } from "../../src/rules/index.js"

describe("rules/index", () => {
  test("wires all 7 core rules", () => {
    const names = allRules.map((r) => r.name).sort()

    expect(names).toEqual([
      "fix_regressions_first",
      "no_commit_failing",
      "no_edit_unread",
      "no_pointless_rerun",
      "no_thrashing",
      "scope_check",
      "test_after_edits",
    ])
  })
})
