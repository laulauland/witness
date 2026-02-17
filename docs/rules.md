# Lint Rules Reference

## How Rules Work

Each rule implements the `LintRule` interface:

```typescript
interface LintRule {
  name: string
  appliesTo: (input: HookInput) => boolean
  check: (input: HookInput) => Effect<string | null, SqlError, SqlClient>
}
```

**Evaluation flow**:
1. Agent makes a tool call → PreToolUse hook fires
2. stdin JSON parsed into `HookInput`
3. Each rule's `appliesTo` checked against the input
4. Applicable rules' `check` functions run concurrently via `Effect.all`
5. Results collected:
   - All null → **allow** (no output, exit 0)
   - Any warning-level violation → **warn** (approve with additionalContext)
   - Any block-level violation → **block** (deny with reason)
6. Block takes precedence over warn. First block wins.

**Configuration**: Each rule has an action: `"block"` | `"warn"` | `"off"`

- **block**: Deny the tool call. The agent cannot proceed with this action.
- **warn**: Allow the tool call but inject a context message. The agent sees the warning in its next turn.
- **off**: Skip the rule entirely.

---

## Rule: `no_edit_unread`

> Don't edit what you haven't read.

| | |
|---|---|
| **Default** | `warn` |
| **Triggers on** | `Edit`, `Write`, `str_replace_editor` |
| **SQL view** | `edited_but_unread` |
| **Condition** | Target file has no `read` event in `file_events` for the current session |

**Rationale**: Agents frequently edit files they haven't read. This leads to incorrect assumptions about file contents, overwriting important code, conflicting with existing patterns, and subtle bugs.

**Example violation**:
```
Agent calls Edit on src/auth.ts — but has never called Read on src/auth.ts this session.
→ ⚠️ no_edit_unread: src/auth.ts has not been read this session.
```

**Example clean**:
```
Agent calls Read on src/auth.ts (t=5), then Edit on src/auth.ts (t=8).
→ Pass (file was read before edit).
```

**Edge case**: `file_create` / `Write` for a *new* file — the agent is creating, not editing. Arguably doesn't need a prior read. Implementation choice: fire for Write (overwrite) but not for first-time creation if the file doesn't exist in prior file_events.

---

## Rule: `fix_regressions_first`

> Fix what you broke before moving on.

| | |
|---|---|
| **Default** | `warn` |
| **Triggers on** | `Edit`, `Write` |
| **SQL view** | `regressions` |
| **Condition** | Regressions exist for files OTHER than the one being edited |

**Rationale**: Agent introduces a regression (edits file A, test starts failing), then wanders off to edit file B instead of fixing the regression. The regression festers while the agent creates more problems.

**Example violation**:
```
t=10: Edit src/auth.ts
t=11: test_token_refresh starts failing (regression on src/auth.ts)
t=12: Agent starts editing src/routes.ts
→ ⚠️ fix_regressions_first: test_token_refresh is failing after your edit to src/auth.ts. Fix the regression before editing other files.
```

**Example clean**:
```
t=10: Edit src/auth.ts  
t=11: test_token_refresh fails
t=12: Agent edits src/auth.ts again (presumably fixing it)
→ Pass (editing the file that caused the regression).
```

**Key nuance**: The rule does NOT fire when editing the file that caused the regression. The agent is presumably trying to fix it.

---

## Rule: `test_after_edits`

> Don't make many changes without checking if they work.

| | |
|---|---|
| **Default** | `warn` (threshold: 3) |
| **Triggers on** | `Edit`, `Write` |
| **SQL view** | `edits_since_last_test` |
| **Condition** | Count of file edit events since last test run ≥ threshold |

**Rationale**: Agent makes many edits without running tests, building up a large untested delta. When tests finally run and fail, it's unclear which edit caused the failure. Small, tested increments are debuggable.

**Configuration**:
```json
"test_after_edits": ["warn", { "threshold": 3 }]
```

The threshold is the number of edit events (not unique files) since the last test command.

**Example violation** (threshold=3):
```
t=5: Edit src/a.ts
t=6: Edit src/b.ts  
t=7: Edit src/c.ts
t=8: Edit src/d.ts  ← 4th edit without test
→ ⚠️ test_after_edits: 4 edits since last test run. Run tests to verify your changes.
```

---

## Rule: `no_thrashing`

> If you've tried 3 times and it's still broken, stop and think.

| | |
|---|---|
| **Default** | `block` (threshold: 3) |
| **Triggers on** | `Edit`, `Write` |
| **SQL view** | `thrashing` |
| **Condition** | Target file edited N+ times with test failures persisting after each edit |

**Rationale**: The agent is stuck in a loop — editing the same file repeatedly without making progress. Each attempt burns tokens and time. It needs to stop, re-read the file, check the test output, and reconsider its approach.

**This is one of the few rules that defaults to `block`.** A thrashing agent will continue thrashing until stopped.

**Configuration**:
```json
"no_thrashing": ["block", { "threshold": 3 }]
```

**Example violation** (threshold=3):
```
t=1: Edit src/auth.ts → test fails
t=2: Edit src/auth.ts → test still fails
t=3: Edit src/auth.ts → test still fails  
t=4: Edit src/auth.ts ← blocked
→ 🛑 no_thrashing: src/auth.ts has been edited 3 times with failures persisting. Stop and reconsider your approach.
```

**Resets when**: Tests pass for the file. The thrashing counter effectively resets when the edit-fail cycle is broken.

---

## Rule: `no_commit_failing`

> Never commit broken code.

| | |
|---|---|
| **Default** | `block` |
| **Triggers on** | `Bash` tool calls matching `git commit` pattern |
| **SQL view** | `failing_tests` |
| **Condition** | `failing_tests` view is non-empty |

**Rationale**: Self-explanatory. Don't commit code with known failing tests.

**Example violation**:
```
Agent runs: Bash { command: "git commit -m 'feat: add auth'" }
DB shows: test_token_refresh = failing
→ 🛑 no_commit_failing: 1 test currently failing (test_token_refresh). Fix tests before committing.
```

**Edge case**: If no tests have been run this session, the rule does NOT fire (no data = no known failures). The rule only fires when there are *known* failures.

---

## Rule: `no_pointless_rerun`

> Don't re-run tests expecting different results.

| | |
|---|---|
| **Default** | `warn` |
| **Triggers on** | `Bash` matching test command patterns (`pytest`, `jest`, `vitest`, `go test`, `cargo test`, etc.) |
| **SQL view** | `edits_since_last_test` |
| **Condition** | `edits_since_last_test` = 0 AND prior test results exist in the session |

**Rationale**: Agent runs tests, they fail, agent re-runs the same tests without changing anything. This is a waste of time and tokens. If tests failed, the agent should edit code first, then re-run.

**Example violation**:
```
t=5: Bash { command: "bun test" } → 2 failures
t=6: Bash { command: "bun test" } ← no edits between
→ ⚠️ no_pointless_rerun: No edits since last test run. Change something before re-running tests.
```

**Exception**: First test run of the session always passes (no prior results).

---

## Rule: `scope_check`

> Stay focused on what you're working on.

| | |
|---|---|
| **Default** | `off` |
| **Triggers on** | `Edit`, `Write` |
| **SQL views** | `blast_radius`, `depends_on`, `file_events` |
| **Condition** | Target file NOT in blast radius of any previously edited file AND not previously read this session |

**Rationale**: Agent starts editing files that have nothing to do with the current task. Useful for focused, well-scoped tasks. Too restrictive for exploratory work, hence **default off**.

**Example violation** (when enabled):
```
Agent has edited src/auth.ts (blast radius: src/middleware.ts, src/routes.ts)
Agent now edits src/database.ts — not in blast radius, never read
→ ⚠️ scope_check: src/database.ts is outside the blast radius of your current edits.
```

**Escape hatch**: Reading a file adds it to scope. If the agent reads `src/database.ts` first, the rule won't fire on a subsequent edit.

---

## Configuration

### File locations (first match wins)

1. `.witness.json` in project root
2. `~/.config/witness/config.json` (global defaults)
3. Built-in defaults

### Format

```json
{
  "rules": {
    "no_edit_unread": "warn",
    "fix_regressions_first": "warn",
    "test_after_edits": ["warn", { "threshold": 3 }],
    "no_thrashing": ["block", { "threshold": 3 }],
    "no_commit_failing": "block",
    "no_pointless_rerun": "warn",
    "scope_check": "off"
  }
}
```

### Simple form

```json
"rule_name": "warn"
```

Action only. Uses default options for the rule.

### With options

```json
"rule_name": ["warn", { "threshold": 3 }]
```

Tuple of `[action, options]`. Available options are rule-specific.

### Default configuration

If no config file exists, these defaults apply:

| Rule | Default Action | Default Options |
|------|---------------|-----------------|
| `no_edit_unread` | `warn` | — |
| `fix_regressions_first` | `warn` | — |
| `test_after_edits` | `warn` | `threshold: 3` |
| `no_thrashing` | `block` | `threshold: 3` |
| `no_commit_failing` | `block` | — |
| `no_pointless_rerun` | `warn` | — |
| `scope_check` | `off` | — |
