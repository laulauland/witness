/**
 * Tests for import extraction from file content.
 *
 * Covers JS/TS, Python, Rust, Go import patterns.
 * Uses fixture files from fixtures/import-samples/.
 */
import { describe, it, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { extractImports, parseFileEvent } from "../../src/parsers/file.js"
import type { HookInput } from "../../src/parsers/Parser.js"

const fixtureDir = resolve(import.meta.dir, "../../fixtures/import-samples")

// ── JS/TS imports ──────────────────────────────────────────────

describe("extractImports — JS/TS", () => {
  it("extracts static import from", () => {
    const imports = extractImports("app.ts", `import { foo } from "bar"`)
    expect(imports).toContain("bar")
  })

  it("extracts default import", () => {
    const imports = extractImports("app.ts", `import React from "react"`)
    expect(imports).toContain("react")
  })

  it("extracts namespace import", () => {
    const imports = extractImports("app.ts", `import * as path from "node:path"`)
    expect(imports).toContain("node:path")
  })

  it("extracts side-effect import", () => {
    const imports = extractImports("app.ts", `import "./setup"`)
    expect(imports).toContain("./setup")
  })

  it("extracts dynamic import()", () => {
    const imports = extractImports("app.ts", `const m = import("./lazy")`)
    expect(imports).toContain("./lazy")
  })

  it("extracts require()", () => {
    const imports = extractImports("app.ts", `const fs = require("fs")`)
    expect(imports).toContain("fs")
  })

  it("extracts require() with single quotes", () => {
    const imports = extractImports("app.ts", `const fs = require('fs')`)
    expect(imports).toContain("fs")
  })

  it("extracts type import", () => {
    const imports = extractImports("app.ts", `import type { Foo } from "@effect/sql"`)
    expect(imports).toContain("@effect/sql")
  })

  it("handles multiple imports in one file", () => {
    const content = readFileSync(resolve(fixtureDir, "sample.ts"), "utf-8")
    const imports = extractImports("sample.ts", content)
    expect(imports).toContain("effect")
    expect(imports).toContain("@effect/sql")
    expect(imports).toContain("@effect/schema")
    expect(imports).toContain("./local-module")
    expect(imports).toContain("./side-effect-only")
    expect(imports).toContain("../relative/path")
    expect(imports).toContain("./lazy-module")
    expect(imports).toContain("lodash")
    expect(imports).toContain("express")
  })

  it("deduplicates repeated imports", () => {
    const content = `import { a } from "foo"\nimport { b } from "foo"`
    const imports = extractImports("app.ts", content)
    expect(imports.filter((m) => m === "foo")).toHaveLength(1)
  })

  it("handles .js extension", () => {
    const imports = extractImports("app.js", `import { x } from "./util"`)
    expect(imports).toContain("./util")
  })

  it("handles .jsx extension", () => {
    const imports = extractImports("App.jsx", `import React from "react"`)
    expect(imports).toContain("react")
  })

  it("handles .mjs extension", () => {
    const imports = extractImports("app.mjs", `import fs from "fs"`)
    expect(imports).toContain("fs")
  })

  it("handles .cjs extension", () => {
    const imports = extractImports("app.cjs", `const x = require("y")`)
    expect(imports).toContain("y")
  })

  it("handles .mts extension", () => {
    const imports = extractImports("app.mts", `import { x } from "y"`)
    expect(imports).toContain("y")
  })

  it("handles .cts extension", () => {
    const imports = extractImports("app.cts", `const x = require("y")`)
    expect(imports).toContain("y")
  })

  it("returns empty for non-import content", () => {
    const imports = extractImports("app.ts", `const x = 5;\nconsole.log(x);`)
    expect(imports).toEqual([])
  })
})

// ── Python imports ─────────────────────────────────────────────

describe("extractImports — Python", () => {
  it("extracts simple import", () => {
    const imports = extractImports("app.py", `import os`)
    expect(imports).toContain("os")
  })

  it("extracts from ... import", () => {
    const imports = extractImports("app.py", `from pathlib import Path`)
    expect(imports).toContain("pathlib")
  })

  it("extracts dotted module import", () => {
    const imports = extractImports("app.py", `import numpy.random`)
    expect(imports).toContain("numpy.random")
  })

  it("extracts dotted from import", () => {
    const imports = extractImports("app.py", `from mypackage.sub import helper`)
    expect(imports).toContain("mypackage.sub")
  })

  it("handles multiple imports from fixture", () => {
    const content = readFileSync(resolve(fixtureDir, "sample.py"), "utf-8")
    const imports = extractImports("sample.py", content)
    expect(imports).toContain("os")
    expect(imports).toContain("sys")
    expect(imports).toContain("json")
    expect(imports).toContain("pathlib")
    expect(imports).toContain("collections")
    expect(imports).toContain("typing")
    expect(imports).toContain("mypackage.submodule")
    expect(imports).toContain("numpy.random")
  })

  it("handles .pyi extension", () => {
    const imports = extractImports("stubs.pyi", `import os`)
    expect(imports).toContain("os")
  })

  it("returns empty for non-import content", () => {
    const imports = extractImports("app.py", `x = 5\nprint(x)`)
    expect(imports).toEqual([])
  })
})

// ── Rust imports ───────────────────────────────────────────────

describe("extractImports — Rust", () => {
  it("extracts use statement", () => {
    const imports = extractImports("main.rs", `use std::collections::HashMap;`)
    expect(imports).toContain("std::collections::HashMap")
  })

  it("extracts use with self", () => {
    const imports = extractImports("main.rs", `use std::io::{self, Read};`)
    expect(imports).toContain("std::io")
  })

  it("extracts crate use", () => {
    const imports = extractImports("main.rs", `use crate::models::User;`)
    expect(imports).toContain("crate::models::User")
  })

  it("extracts super use", () => {
    const imports = extractImports("main.rs", `use super::utils;`)
    expect(imports).toContain("super::utils")
  })

  it("extracts mod declaration", () => {
    const imports = extractImports("main.rs", `mod config;`)
    expect(imports).toContain("config")
  })

  it("handles multiple from fixture", () => {
    const content = readFileSync(resolve(fixtureDir, "sample.rs"), "utf-8")
    const imports = extractImports("sample.rs", content)
    expect(imports).toContain("std::collections::HashMap")
    expect(imports).toContain("std::io")
    expect(imports).toContain("crate::models::User")
    expect(imports).toContain("super::utils")
    expect(imports).toContain("config")
    expect(imports).toContain("database")
  })

  it("returns empty for non-import content", () => {
    const imports = extractImports("main.rs", `fn main() { println!("hi"); }`)
    expect(imports).toEqual([])
  })
})

// ── Go imports ─────────────────────────────────────────────────

describe("extractImports — Go", () => {
  it("extracts single import", () => {
    const imports = extractImports("main.go", `import "fmt"`)
    expect(imports).toContain("fmt")
  })

  it("extracts block imports", () => {
    const content = `import (\n\t"fmt"\n\t"os"\n)`
    const imports = extractImports("main.go", content)
    expect(imports).toContain("fmt")
    expect(imports).toContain("os")
  })

  it("handles mixed single and block from fixture", () => {
    const content = readFileSync(resolve(fixtureDir, "sample.go"), "utf-8")
    const imports = extractImports("sample.go", content)
    expect(imports).toContain("fmt")
    expect(imports).toContain("os")
    expect(imports).toContain("encoding/json")
    expect(imports).toContain("net/http")
    expect(imports).toContain("strings")
  })

  it("returns empty for non-import content", () => {
    const imports = extractImports("main.go", `package main\nfunc main() {}`)
    expect(imports).toEqual([])
  })
})

// ── Unknown extensions ─────────────────────────────────────────

describe("extractImports — unknown language", () => {
  it("returns empty for .txt", () => {
    const imports = extractImports("readme.txt", `import something`)
    expect(imports).toEqual([])
  })

  it("returns empty for .md", () => {
    const imports = extractImports("README.md", `import { foo } from "bar"`)
    expect(imports).toEqual([])
  })

  it("returns empty for empty content", () => {
    const imports = extractImports("app.ts", "")
    expect(imports).toEqual([])
  })
})

// ── Integration: parseFileEvent generates Import facts ────────

describe("parseFileEvent — import extraction", () => {
  it("Read with tool_output generates Import facts for JS/TS", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { path: "src/app.ts" },
      tool_output: `import { Effect } from "effect"\nimport { SqlClient } from "@effect/sql"`,
    }
    const facts = parseFileEvent(input)
    expect(facts.length).toBeGreaterThanOrEqual(3) // 1 FileEvent + 2 Imports
    const fileEvent = facts.find((f) => f._tag === "FileEvent")
    expect(fileEvent).toBeDefined()
    const imports = facts.filter((f) => f._tag === "Import")
    expect(imports.length).toBe(2)
    if (imports[0]!._tag === "Import") {
      expect(imports[0]!.source_file).toBe("src/app.ts")
    }
  })

  it("Read without tool_output generates no Import facts", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { path: "src/app.ts" },
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    expect(facts[0]!._tag).toBe("FileEvent")
  })

  it("Edit does not generate Import facts", () => {
    const input: HookInput = {
      tool_name: "Edit",
      tool_input: { path: "src/app.ts" },
      tool_output: `import { x } from "y"`,
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    expect(facts[0]!._tag).toBe("FileEvent")
  })

  it("Read on .py file extracts Python imports", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { path: "src/app.py" },
      tool_output: `import os\nfrom pathlib import Path`,
    }
    const facts = parseFileEvent(input)
    const imports = facts.filter((f) => f._tag === "Import")
    expect(imports.length).toBe(2)
  })

  it("Read on unknown extension generates no Import facts", () => {
    const input: HookInput = {
      tool_name: "Read",
      tool_input: { path: "README.md" },
      tool_output: `import { foo } from "bar"`,
    }
    const facts = parseFileEvent(input)
    expect(facts).toHaveLength(1)
    expect(facts[0]!._tag).toBe("FileEvent")
  })
})
