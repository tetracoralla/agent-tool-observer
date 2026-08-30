import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveConfig } from "../src/config.mjs";

const home = path.resolve("/tmp/agent-tool-observer-config-home");

test("configuration rejects misspelled disabled providers", () => {
  assert.throws(
    () => resolveConfig({ ATO_DISABLE_PROVIDERS: "codxe" }, home),
    { code: "CONFIG_INVALID" }
  );
});

test("provider source overrides require unambiguous absolute paths", () => {
  for (const [name, value] of [
    ["ATO_CODEX_ROOTS", "relative/codex"],
    ["ATO_CLAUDE_ROOTS", "relative/claude"],
    ["ATO_ZCODE_DB", "relative/zcode.sqlite"],
    ["ATO_DIRECT_RUNTIME_LOGS", "relative/observations.jsonl"],
    ["ATO_DIRECT_RUNTIME_LOGS", `/tmp/one${path.delimiter}`]
  ]) {
    assert.throws(() => resolveConfig({ [name]: value }, home), { code: "CONFIG_INVALID" });
  }
});
