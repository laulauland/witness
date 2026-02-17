import { SqlClient } from "@effect/sql"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { currentTick, tick } from "../src/Clock.js"
import { makeTestLayer } from "./helpers/db.js"

describe("Clock", () => {
  test("first tick returns 1", async () => {
    const result = await Effect.gen(function* () {
      return yield* tick("session-1")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe(1)
  })

  test("ticks are monotonically increasing", async () => {
    const result = await Effect.gen(function* () {
      const t1 = yield* tick("session-1")
      const t2 = yield* tick("session-1")
      const t3 = yield* tick("session-1")
      const t4 = yield* tick("session-1")
      const t5 = yield* tick("session-1")
      return [t1, t2, t3, t4, t5]
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toEqual([1, 2, 3, 4, 5])
  })

  test("different sessions have independent clocks", async () => {
    const result = await Effect.gen(function* () {
      const a1 = yield* tick("session-a")
      const a2 = yield* tick("session-a")
      const b1 = yield* tick("session-b")
      const a3 = yield* tick("session-a")
      const b2 = yield* tick("session-b")
      return { a: [a1, a2, a3], b: [b1, b2] }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.a).toEqual([1, 2, 3])
    expect(result.b).toEqual([1, 2])
  })

  test("currentTick returns 0 for unknown session", async () => {
    const result = await Effect.gen(function* () {
      return yield* currentTick("nonexistent")
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe(0)
  })

  test("currentTick returns current value without incrementing", async () => {
    const result = await Effect.gen(function* () {
      yield* tick("session-1")
      yield* tick("session-1")
      yield* tick("session-1")
      const current = yield* currentTick("session-1")
      // Should still be 3 — currentTick doesn't increment
      const afterCurrent = yield* currentTick("session-1")
      return { current, afterCurrent }
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result.current).toBe(3)
    expect(result.afterCurrent).toBe(3)
  })

  test("tick after currentTick continues from correct value", async () => {
    const result = await Effect.gen(function* () {
      yield* tick("session-1")
      yield* tick("session-1")
      yield* currentTick("session-1")
      const next = yield* tick("session-1")
      return next
    }).pipe(Effect.provide(makeTestLayer()), Effect.runPromise)

    expect(result).toBe(3)
  })
})
