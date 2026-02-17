/**
 * DDL for all witness tables, indexes, and derived views.
 *
 * All tables use CREATE TABLE IF NOT EXISTS for idempotent init.
 * Every row has: session_id, t (monotonic clock), ts (wall clock).
 */
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

/** Apply all DDL statements (tables, indexes, views). */
export const applySchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // ── Clock table ─────────────────────────────────────────────
  yield* sql`
    CREATE TABLE IF NOT EXISTS clock (
      session_id TEXT PRIMARY KEY,
      current_t  INTEGER NOT NULL DEFAULT 0
    )
  `

  // ── Core fact tables ────────────────────────────────────────

  yield* sql`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      tool_name   TEXT    NOT NULL,
      tool_input  TEXT,
      tool_output TEXT
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS file_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      event       TEXT    NOT NULL,
      file_path   TEXT    NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS test_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      test_name   TEXT    NOT NULL,
      outcome     TEXT    NOT NULL,
      message     TEXT
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS lint_results (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      file_path   TEXT    NOT NULL,
      line        INTEGER,
      rule        TEXT    NOT NULL,
      severity    TEXT    NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS type_errors (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT    NOT NULL,
      t           INTEGER NOT NULL,
      ts          TEXT    NOT NULL DEFAULT (datetime('now')),
      file_path   TEXT    NOT NULL,
      line        INTEGER,
      message     TEXT    NOT NULL
    )
  `

  yield* sql`
    CREATE TABLE IF NOT EXISTS imports (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT    NOT NULL,
      t               INTEGER NOT NULL,
      ts              TEXT    NOT NULL DEFAULT (datetime('now')),
      source_file     TEXT    NOT NULL,
      imported_module TEXT    NOT NULL
    )
  `

  // ── Indexes ─────────────────────────────────────────────────

  yield* sql`CREATE INDEX IF NOT EXISTS idx_tool_calls_session   ON tool_calls   (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_file_events_session  ON file_events  (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_file_events_path     ON file_events  (session_id, file_path)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_test_results_session ON test_results (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_test_results_name    ON test_results (session_id, test_name)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_lint_results_session ON lint_results (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_lint_results_path    ON lint_results (session_id, file_path)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_type_errors_session  ON type_errors  (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_type_errors_path     ON type_errors  (session_id, file_path)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_imports_session      ON imports      (session_id, t)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_imports_source       ON imports      (session_id, source_file)`

  // ── Derived views ───────────────────────────────────────────

  // Latest outcome per test_name per session
  yield* sql`
    CREATE VIEW IF NOT EXISTS current_test_state AS
    SELECT tr.session_id, tr.test_name, tr.outcome, tr.message, tr.t
    FROM test_results tr
    INNER JOIN (
      SELECT session_id, test_name, MAX(t) AS max_t
      FROM test_results
      GROUP BY session_id, test_name
    ) latest ON tr.session_id = latest.session_id
            AND tr.test_name  = latest.test_name
            AND tr.t          = latest.max_t
  `

  // Tests currently failing
  yield* sql`
    CREATE VIEW IF NOT EXISTS failing_tests AS
    SELECT session_id, test_name, message, t
    FROM current_test_state
    WHERE outcome = 'fail'
  `

  // Tests that were passing before a file edit, then failing after.
  // Excludes tests that were already failing before the edit.
  yield* sql`
    CREATE VIEW IF NOT EXISTS regressions AS
    SELECT
      fail_result.session_id,
      fail_result.test_name,
      fail_result.message,
      pass_result.t AS pass_t,
      edit.t AS edit_t,
      fail_result.t AS fail_t,
      edit.file_path AS likely_cause
    FROM test_results fail_result
    INNER JOIN test_results pass_result
      ON fail_result.session_id = pass_result.session_id
     AND fail_result.test_name = pass_result.test_name
     AND pass_result.outcome = 'pass'
     AND pass_result.t < fail_result.t
    INNER JOIN file_events edit
      ON fail_result.session_id = edit.session_id
     AND edit.event = 'edit'
     AND edit.t > pass_result.t
     AND edit.t < fail_result.t
    WHERE fail_result.outcome = 'fail'
      AND fail_result.t = (
        SELECT MAX(t) FROM test_results tr2
        WHERE tr2.session_id = fail_result.session_id
          AND tr2.test_name = fail_result.test_name
      )
      AND pass_result.t = (
        SELECT MAX(t) FROM test_results tr3
        WHERE tr3.session_id = pass_result.session_id
          AND tr3.test_name = pass_result.test_name
          AND tr3.outcome = 'pass'
          AND tr3.t < fail_result.t
      )
      AND NOT EXISTS (
        SELECT 1 FROM test_results pre_fail
        WHERE pre_fail.session_id = fail_result.session_id
          AND pre_fail.test_name = fail_result.test_name
          AND pre_fail.outcome = 'fail'
          AND pre_fail.t > pass_result.t
          AND pre_fail.t < edit.t
      )
  `

  // Files edited 3+ times with failures persisting after each edit
  yield* sql`
    CREATE VIEW IF NOT EXISTS thrashing AS
    SELECT
      fe.session_id,
      fe.file_path,
      COUNT(DISTINCT fe.t) AS edit_count,
      MAX(fe.t) AS last_edit_t
    FROM file_events fe
    WHERE fe.event = 'edit'
      AND EXISTS (
        SELECT 1 FROM failing_tests ft
        WHERE ft.session_id = fe.session_id
      )
    GROUP BY fe.session_id, fe.file_path
    HAVING COUNT(DISTINCT fe.t) >= 3
  `

  // Count of file edits since last test run in the session
  yield* sql`
    CREATE VIEW IF NOT EXISTS edits_since_last_test AS
    SELECT
      fe.session_id,
      COUNT(*) AS edit_count,
      COALESCE(
        (SELECT MAX(t) FROM test_results tr WHERE tr.session_id = fe.session_id),
        0
      ) AS last_test_t
    FROM file_events fe
    WHERE fe.event = 'edit'
      AND fe.t > COALESCE(
        (SELECT MAX(t) FROM test_results tr2 WHERE tr2.session_id = fe.session_id),
        0
      )
    GROUP BY fe.session_id
  `

  // Files with edit events but no prior read event in the session
  yield* sql`
    CREATE VIEW IF NOT EXISTS edited_but_unread AS
    SELECT DISTINCT
      fe.session_id,
      fe.file_path,
      fe.t AS edit_t
    FROM file_events fe
    WHERE fe.event = 'edit'
      AND NOT EXISTS (
        SELECT 1 FROM file_events fr
        WHERE fr.session_id = fe.session_id
          AND fr.file_path  = fe.file_path
          AND fr.event      = 'read'
          AND fr.t < fe.t
      )
  `

  // Transitive import closure (recursive CTE)
  yield* sql`
    CREATE VIEW IF NOT EXISTS depends_on AS
    WITH RECURSIVE dep(session_id, source_file, imported_module, depth) AS (
      SELECT session_id, source_file, imported_module, 1
      FROM imports
      UNION
      SELECT d.session_id, d.source_file, i.imported_module, d.depth + 1
      FROM dep d
      INNER JOIN imports i
        ON d.session_id      = i.session_id
       AND d.imported_module = i.source_file
      WHERE d.depth < 10
    )
    SELECT DISTINCT session_id, source_file, imported_module, MIN(depth) AS depth
    FROM dep
    GROUP BY session_id, source_file, imported_module
  `

  // Reverse transitive dependencies of recently edited files
  yield* sql`
    CREATE VIEW IF NOT EXISTS blast_radius AS
    SELECT DISTINCT
      d.session_id,
      fe.file_path AS edited_file,
      d.source_file AS affected_file,
      d.depth
    FROM file_events fe
    INNER JOIN depends_on d
      ON fe.session_id     = d.session_id
     AND fe.file_path      = d.imported_module
    WHERE fe.event = 'edit'
  `

  // Tests sharing the same failure message
  yield* sql`
    CREATE VIEW IF NOT EXISTS error_clusters AS
    SELECT
      ft.session_id,
      ft.message,
      COUNT(*) AS test_count,
      GROUP_CONCAT(ft.test_name, ', ') AS tests
    FROM failing_tests ft
    WHERE ft.message IS NOT NULL
    GROUP BY ft.session_id, ft.message
    HAVING COUNT(*) > 1
  `

  // Edits followed by test fail→pass transitions
  yield* sql`
    CREATE VIEW IF NOT EXISTS likely_fixes AS
    SELECT
      fe.session_id,
      fe.file_path,
      fe.t AS edit_t,
      tr_fail.test_name,
      tr_fail.t AS fail_t,
      tr_pass.t AS fix_t
    FROM file_events fe
    INNER JOIN test_results tr_fail
      ON fe.session_id = tr_fail.session_id
     AND tr_fail.outcome = 'fail'
     AND tr_fail.t < fe.t
    INNER JOIN test_results tr_pass
      ON fe.session_id = tr_pass.session_id
     AND tr_pass.test_name = tr_fail.test_name
     AND tr_pass.outcome = 'pass'
     AND tr_pass.t > fe.t
    WHERE fe.event = 'edit'
      AND NOT EXISTS (
        SELECT 1 FROM file_events fe2
        WHERE fe2.session_id = fe.session_id
          AND fe2.event = 'edit'
          AND fe2.t > fe.t
          AND fe2.t < tr_pass.t
      )
  `

  // Files edited but not tested since the edit
  yield* sql`
    CREATE VIEW IF NOT EXISTS untested_edits AS
    SELECT DISTINCT
      fe.session_id,
      fe.file_path,
      MAX(fe.t) AS last_edit_t
    FROM file_events fe
    WHERE fe.event = 'edit'
      AND NOT EXISTS (
        SELECT 1 FROM test_results tr
        WHERE tr.session_id = fe.session_id
          AND tr.t > fe.t
      )
    GROUP BY fe.session_id, fe.file_path
  `
})
