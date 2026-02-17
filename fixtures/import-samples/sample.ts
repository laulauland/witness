import { Effect, Layer } from "effect"
import type { SqlClient } from "@effect/sql"
import * as Schema from "@effect/schema"
import defaultExport from "./local-module"
import "./side-effect-only"
import { something } from '../relative/path'

const lazy = import("./lazy-module")
const dynamicReq = require("lodash")
const conditionalReq = require('express')

export const foo = 42
