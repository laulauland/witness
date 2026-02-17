/**
 * Tests for the parser router.
 */
import { describe, it, expect } from "bun:test"
import { route } from "../../src/parsers/index.js"
import { parseFileEvent } from "../../src/parsers/file.js"

describe("Parser router", () => {
  // ── File tools route to file parser ─────────────────────────

  it("routes Edit to file parser", () => {
    expect(route("Edit")).toBe(parseFileEvent)
  })

  it("routes edit (lowercase) to file parser", () => {
    expect(route("edit")).toBe(parseFileEvent)
  })

  it("routes str_replace_editor to file parser", () => {
    expect(route("str_replace_editor")).toBe(parseFileEvent)
  })

  it("routes Write to file parser", () => {
    expect(route("Write")).toBe(parseFileEvent)
  })

  it("routes write (lowercase) to file parser", () => {
    expect(route("write")).toBe(parseFileEvent)
  })

  it("routes file_create to file parser", () => {
    expect(route("file_create")).toBe(parseFileEvent)
  })

  it("routes create_file to file parser", () => {
    expect(route("create_file")).toBe(parseFileEvent)
  })

  it("routes Read to file parser", () => {
    expect(route("Read")).toBe(parseFileEvent)
  })

  it("routes read (lowercase) to file parser", () => {
    expect(route("read")).toBe(parseFileEvent)
  })

  it("routes view to file parser", () => {
    expect(route("view")).toBe(parseFileEvent)
  })

  it("routes cat to file parser", () => {
    expect(route("cat")).toBe(parseFileEvent)
  })

  // ── Unknown tools return undefined ──────────────────────────

  it("returns undefined for Bash", () => {
    expect(route("Bash")).toBeUndefined()
  })

  it("returns undefined for unknown tool", () => {
    expect(route("SomeRandomTool")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(route("")).toBeUndefined()
  })
})
