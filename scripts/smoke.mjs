import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "agent-tool-observer-smoke-"));
const codexRoot = path.join(temporary, "codex");
const claudeRoot = path.join(temporary, "claude");
const stateDir = path.join(temporary, "state");
const zcodePath = path.join(temporary, "zcode.sqlite");
fs.mkdirSync(codexRoot, { recursive: true });
fs.mkdirSync(claudeRoot, { recursive: true });

function run(...argumentsList) {
  const result = spawnSync(process.execPath, ["--no-warnings", path.join(repoRoot, "src", "cli.mjs"), ...argumentsList], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ATO_STATE_DIR: stateDir,
      ATO_CODEX_ROOTS: codexRoot,
      ATO_CLAUDE_ROOTS: claudeRoot,
      ATO_ZCODE_DB: zcodePath
    }
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

try {
  const timestamp = new Date().toISOString();
  fs.writeFileSync(path.join(codexRoot, "session.jsonl"), [
    JSON.stringify({ timestamp, type: "session_meta", payload: { id: "codex-smoke" } }),
    JSON.stringify({ timestamp, type: "response_item", payload: { type: "custom_tool_call", call_id: "call-1", name: "exec", status: "completed", input: "await tools.mcp__math_anchor__math_run({}); await tools.mcp__universal_inspector__file_inspect({});" } })
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(claudeRoot, "session.jsonl"), [
    JSON.stringify({ timestamp, type: "assistant", sessionId: "claude-smoke", uuid: "u1", message: { id: "m1", usage: { input_tokens: 2, output_tokens: 1 }, content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/private/path" } }] } }),
    JSON.stringify({ timestamp, type: "user", sessionId: "claude-smoke", uuid: "u2", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "private" }] } })
  ].join("\n") + "\n");
  const zcode = new DatabaseSync(zcodePath);
  zcode.exec(`
    CREATE TABLE tool_usage (
      id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, tool_call_id TEXT,
      tool_name TEXT, status TEXT, started_at INTEGER, completed_at INTEGER,
      duration_ms INTEGER, retry_count INTEGER
    );
    CREATE TABLE model_usage (
      id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, status TEXT,
      started_at INTEGER, completed_at INTEGER, duration_ms INTEGER,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      cache_read_input_tokens INTEGER, computed_total_tokens INTEGER
    );
  `);
  const now = Date.now();
  zcode.prepare("INSERT INTO tool_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "z1", "zs", "zt", "zc", "Bash", "completed", now, now + 5, 5, 0
  );
  zcode.prepare("INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "zm", "zs", "zt", "completed", now, now + 5, 5, 3, 1, 0, 0, 4
  );
  zcode.close();

  const collection = run("collect", "--json");
  assert.equal(collection.status, "completed");
  assert.equal(collection.rawContentStored, false);
  assert.equal(collection.networkUsed, false);
  assert.equal(collection.modelCalls, 0);
  const receiptPath = path.join(temporary, "procedure-receipt.json");
  fs.writeFileSync(receiptPath, JSON.stringify({
    schemaVersion: "openadam.procedure-receipt.v0.1",
    procedureId: "org.openadam.structured-data.preflight",
    procedureVersion: "0.1.0",
    invocationId: "smoke-private-id",
    implementation: { id: "org.openadam.structured-data-preflight", version: "0.1.0" },
    outcome: "success",
    startedAt: timestamp,
    completedAt: timestamp,
    inputDigest: `sha256:${"a".repeat(64)}`,
    outputDigest: `sha256:${"b".repeat(64)}`,
    stages: [{
      stageId: "inspect-file",
      status: "success",
      capability: { id: "org.openadam.file.inspect", version: "0.1.0", operationId: "inspect" },
      provider: { id: "io.github.tetracoralla.universal-inspector", version: "0.1.0" },
      binding: { transport: "mcp-tool", target: "file_inspect" },
      durationMs: 1,
      effects: ["read"]
    }]
  }), { mode: 0o600 });
  const ingestion = run("ingest-receipts", "--file", receiptPath, "--json");
  assert.equal(ingestion.proceduresWritten, 1);
  assert.equal(ingestion.capabilityStagesWritten, 1);
  const report = run("report", "--days", "1", "--json");
  assert.equal(report.tools.length >= 4, true);
  assert.deepEqual(report.portfolio.retireCandidates, []);
  assert.equal(report.procedures.length, 1);
  assert.equal(report.capabilities.length, 1);
  assert.equal(report.capabilities[0].passiveObservedCalls, 1);
  assert.equal(report.capabilities[0].passiveMappingBasis, "declared-receipt-binding-target");
  assert.equal(report.privacy.rawContentStored, false);
  const status = run("status", "--json");
  assert.equal(status.providers.length, 3);
  process.stdout.write("smoke: ok\n");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
