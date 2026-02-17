/**
 * All lint rules, exported as an array.
 *
 * Phase 3: no_edit_unread, test_after_edits
 * Later phases add: fix_regressions_first, no_thrashing, no_commit_failing,
 *                   no_pointless_rerun, scope_check
 */
import type { LintRule } from "./Rule.js"
import { NoEditUnread } from "./NoEditUnread.js"
import { TestAfterEdits } from "./TestAfterEdits.js"

export const allRules: ReadonlyArray<LintRule> = [
  NoEditUnread,
  TestAfterEdits,
]

export { NoEditUnread } from "./NoEditUnread.js"
export { TestAfterEdits } from "./TestAfterEdits.js"
export type { LintRule, RuleAction, RuleConfig, RuleViolation } from "./Rule.js"
