import { createRequire } from "node:module";
import type * as Nightwear from "../nightwear.js";
import * as fake from "./kolmafia.js";

// nightwear.js is CommonJS, and vitest hands a CommonJS require() straight to
// node, where neither vi.mock nor a vite alias can reach it. So put the fake
// in node's own module cache under the name the script asks for, before the
// script is loaded.
const require = createRequire(import.meta.url);
const id = require.resolve("kolmafia");
require.cache[id] = {
  id,
  filename: id,
  loaded: true,
  exports: fake,
} as NodeJS.Module;

export default require("../nightwear.js") as typeof Nightwear;
