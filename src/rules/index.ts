/**
 * All lint rules, exported as an array.
 *
 * Phase 3: no_edit_unread, test_after_edits
 * Phase 4: no_commit_failing, fix_regressions_first
 * Phase 5: no_thrashing, no_pointless_rerun
 * Scope + blast-radius: scope_check
 */
import type { LintRule } from "./Rule.js"
import { NoEditUnread } from "./NoEditUnread.js"
import { TestAfterEdits } from "./TestAfterEdits.js"
import { NoCommitFailing } from "./NoCommitFailing.js"
import { FixRegressionsFirst } from "./FixRegressionsFirst.js"
import { NoThrashing } from "./NoThrashing.js"
import { NoPointlessRerun } from "./NoPointlessRerun.js"
import { ScopeCheck } from "./ScopeCheck.js"

export const allRules: ReadonlyArray<LintRule> = [
  NoEditUnread,
  TestAfterEdits,
  NoCommitFailing,
  FixRegressionsFirst,
  NoThrashing,
  NoPointlessRerun,
  ScopeCheck,
]

export { NoEditUnread } from "./NoEditUnread.js"
export { TestAfterEdits } from "./TestAfterEdits.js"
export { NoCommitFailing } from "./NoCommitFailing.js"
export { FixRegressionsFirst } from "./FixRegressionsFirst.js"
export { NoThrashing } from "./NoThrashing.js"
export { NoPointlessRerun } from "./NoPointlessRerun.js"
export { ScopeCheck } from "./ScopeCheck.js"
export type { LintRule, RuleAction, RuleConfig, RuleViolation } from "./Rule.js"
