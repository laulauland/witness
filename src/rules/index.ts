/**
 * All lint rules, exported as an array.
 *
 * Phase 3: no_edit_unread, test_after_edits
 * Phase 4: no_commit_failing, fix_regressions_first
 * Later phases add: no_thrashing, no_pointless_rerun, scope_check
 */
import type { LintRule } from "./Rule.js"
import { NoEditUnread } from "./NoEditUnread.js"
import { TestAfterEdits } from "./TestAfterEdits.js"
import { NoCommitFailing } from "./NoCommitFailing.js"
import { FixRegressionsFirst } from "./FixRegressionsFirst.js"

export const allRules: ReadonlyArray<LintRule> = [
  NoEditUnread,
  TestAfterEdits,
  NoCommitFailing,
  FixRegressionsFirst,
]

export { NoEditUnread } from "./NoEditUnread.js"
export { TestAfterEdits } from "./TestAfterEdits.js"
export { NoCommitFailing } from "./NoCommitFailing.js"
export { FixRegressionsFirst } from "./FixRegressionsFirst.js"
export type { LintRule, RuleAction, RuleConfig, RuleViolation } from "./Rule.js"
