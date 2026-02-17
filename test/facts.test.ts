import { describe, expect, test } from "bun:test"
import {
  FileEvent,
  TestResult,
  LintResult,
  TypeError,
  Import,
  ToolCall,
  isFact,
  type Fact,
} from "../src/Facts.js"

describe("Facts", () => {
  test("FileEvent constructs correctly", () => {
    const fact = FileEvent("s1", 1, "edit", "src/foo.ts")
    expect(fact._tag).toBe("FileEvent")
    expect(fact.session_id).toBe("s1")
    expect(fact.t).toBe(1)
    expect(fact.event).toBe("edit")
    expect(fact.file_path).toBe("src/foo.ts")
  })

  test("FileEvent supports all event types", () => {
    const read = FileEvent("s1", 1, "read", "a.ts")
    const edit = FileEvent("s1", 2, "edit", "a.ts")
    const create = FileEvent("s1", 3, "create", "b.ts")
    const del = FileEvent("s1", 4, "delete", "c.ts")

    expect(read.event).toBe("read")
    expect(edit.event).toBe("edit")
    expect(create.event).toBe("create")
    expect(del.event).toBe("delete")
  })

  test("TestResult constructs correctly", () => {
    const fact = TestResult("s1", 1, "test_auth", "fail", "401 error")
    expect(fact._tag).toBe("TestResult")
    expect(fact.session_id).toBe("s1")
    expect(fact.t).toBe(1)
    expect(fact.test_name).toBe("test_auth")
    expect(fact.outcome).toBe("fail")
    expect(fact.message).toBe("401 error")
  })

  test("TestResult message defaults to null", () => {
    const fact = TestResult("s1", 1, "test_x", "pass")
    expect(fact.message).toBeNull()
  })

  test("TestResult supports all outcomes", () => {
    expect(TestResult("s1", 1, "t", "pass").outcome).toBe("pass")
    expect(TestResult("s1", 1, "t", "fail").outcome).toBe("fail")
    expect(TestResult("s1", 1, "t", "skip").outcome).toBe("skip")
    expect(TestResult("s1", 1, "t", "error").outcome).toBe("error")
  })

  test("LintResult constructs correctly", () => {
    const fact = LintResult("s1", 1, "src/foo.ts", 42, "no-unused-vars", "warning")
    expect(fact._tag).toBe("LintResult")
    expect(fact.file_path).toBe("src/foo.ts")
    expect(fact.line).toBe(42)
    expect(fact.rule).toBe("no-unused-vars")
    expect(fact.severity).toBe("warning")
  })

  test("LintResult line can be null", () => {
    const fact = LintResult("s1", 1, "src/foo.ts", null, "rule", "error")
    expect(fact.line).toBeNull()
  })

  test("TypeError constructs correctly", () => {
    const fact = TypeError("s1", 1, "src/foo.ts", 10, "Type 'string' is not assignable")
    expect(fact._tag).toBe("TypeError")
    expect(fact.file_path).toBe("src/foo.ts")
    expect(fact.line).toBe(10)
    expect(fact.message).toBe("Type 'string' is not assignable")
  })

  test("TypeError line can be null", () => {
    const fact = TypeError("s1", 1, "src/foo.ts", null, "msg")
    expect(fact.line).toBeNull()
  })

  test("Import constructs correctly", () => {
    const fact = Import("s1", 1, "src/foo.ts", "./bar.js")
    expect(fact._tag).toBe("Import")
    expect(fact.source_file).toBe("src/foo.ts")
    expect(fact.imported_module).toBe("./bar.js")
  })

  test("ToolCall constructs correctly", () => {
    const fact = ToolCall("s1", 1, "Edit", '{"path":"a.ts"}', "File edited")
    expect(fact._tag).toBe("ToolCall")
    expect(fact.tool_name).toBe("Edit")
    expect(fact.tool_input).toBe('{"path":"a.ts"}')
    expect(fact.tool_output).toBe("File edited")
  })

  test("ToolCall input/output default to null", () => {
    const fact = ToolCall("s1", 1, "Edit")
    expect(fact.tool_input).toBeNull()
    expect(fact.tool_output).toBeNull()
  })

  test("isFact type guard works for all tags", () => {
    const facts: Fact[] = [
      FileEvent("s1", 1, "read", "a.ts"),
      TestResult("s1", 2, "test_x", "pass"),
      LintResult("s1", 3, "b.ts", 1, "rule", "error"),
      TypeError("s1", 4, "c.ts", 1, "msg"),
      Import("s1", 5, "d.ts", "e.ts"),
      ToolCall("s1", 6, "Edit"),
    ]

    expect(facts.filter(isFact("FileEvent"))).toHaveLength(1)
    expect(facts.filter(isFact("TestResult"))).toHaveLength(1)
    expect(facts.filter(isFact("LintResult"))).toHaveLength(1)
    expect(facts.filter(isFact("TypeError"))).toHaveLength(1)
    expect(facts.filter(isFact("Import"))).toHaveLength(1)
    expect(facts.filter(isFact("ToolCall"))).toHaveLength(1)
  })
})
