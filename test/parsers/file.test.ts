/**
 * Tests for the file event parser.
 */
import { describe, it, expect } from "bun:test"
import { parseFileEvent } from "../../src/parsers/file.js"
import type { HookInput } from "../../src/parsers/Parser.js"

describe("File event parser", () => {
  // ── Edit tools ────────────────────────────────────────────────

  it("Edit → edit event", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: { path: "src/foo.ts", old_text: "a", new_text: "b" },
      tool_output: "File edited",
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    expect(facts[0]!._tag).toBe("FileEvent")
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("edit")
      expect(facts[0]!.file_path).toBe("src/foo.ts")
    }
  })

  it("str_replace_editor → edit event", () => {
    const input: HookInput = {
      tool_name: "str_replace_editor",
      tool_input: { path: "src/utils.ts" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("edit")
      expect(facts[0]!.file_path).toBe("src/utils.ts")
    }
  })

  // ── Write/create tools ────────────────────────────────────────

  it("Write → create event", () => {
    const input: HookInput = {
      tool_name: "Write",
      tool_input: { path: "src/new.ts", content: "hello" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("create")
      expect(facts[0]!.file_path).toBe("src/new.ts")
    }
  })

  it("file_create → create event", () => {
    const input: HookInput = {
      tool_name: "file_create",
      tool_input: { path: "src/module.ts" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("create")
      expect(facts[0]!.file_path).toBe("src/module.ts")
    }
  })

  // ── Read/view tools ───────────────────────────────────────────

  it("Read → read event", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { path: "src/auth.ts" },
      tool_output: "file content here",
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("read")
      expect(facts[0]!.file_path).toBe("src/auth.ts")
    }
  })

  it("view → read event", () => {
    const input: HookInput = {
      tool_name: "view",
      tool_input: { path: "src/main.ts" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.event).toBe("read")
      expect(facts[0]!.file_path).toBe("src/main.ts")
    }
  })

  // ── Path extraction variants ──────────────────────────────────

  it("extracts path from file_path field", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: { file_path: "src/alt.ts" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.file_path).toBe("src/alt.ts")
    }
  })

  it("extracts path from file field", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { file: "readme.md" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.file_path).toBe("readme.md")
    }
  })

  it("extracts path from filename field", () => {
    const input: HookInput = {
      tool_name: "Write",
      tool_input: { filename: "config.json" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    if (facts[0]!._tag === "FileEvent") {
      expect(facts[0]!.file_path).toBe("config.json")
    }
  })

  // ── Edge cases / no-crash ─────────────────────────────────────

  it("returns empty array for unknown tool_name", () => {
    const input: HookInput = {
      tool_name: "Bash",
      tool_input: { command: "ls" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toEqual([])
  })

  it("returns empty array when no path found", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: { old_text: "a", new_text: "b" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toEqual([])
  })

  it("returns empty array for empty tool_input", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: {},
    }
    const facts = parseFileEvent(input)
    expect(facts).toEqual([])
  })

  it("returns empty array for empty string path", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: { path: "" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toEqual([])
  })

  it("handles non-object tool_input gracefully", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: "not an object" as unknown as Record<string, unknown>,
    }
    const facts = parseFileEvent(input)
    expect(facts).toEqual([])
  })
})
