import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../src/cli.mjs";

test("CLI rejects ignored dry-run and command-specific options before any action", () => {
  assert.throws(
    () => parseArguments(["purge", "--dry-run", "--confirm-local-data-removal"]),
    { code: "ARGUMENT_INVALID" }
  );
  assert.throws(() => parseArguments(["uninstall", "--dry-run"]), { code: "ARGUMENT_INVALID" });
  assert.throws(() => parseArguments(["collect", "--days", "7"]), { code: "ARGUMENT_INVALID" });
  assert.throws(() => parseArguments(["status", "--openadam"]), { code: "ARGUMENT_INVALID" });
});

test("CLI rejects duplicate options instead of silently changing intent", () => {
  assert.throws(() => parseArguments(["report", "--days", "7", "--days", "30"]), {
    code: "ARGUMENT_INVALID"
  });
  assert.throws(() => parseArguments(["collect", "--json", "--json"]), {
    code: "ARGUMENT_INVALID"
  });
});

test("CLI does not expose the retired Procedure receipt importer", () => {
  assert.throws(() => parseArguments(["ingest-receipts", "--file", "/tmp/legacy.json"]), {
    code: "ARGUMENT_INVALID"
  });
});
