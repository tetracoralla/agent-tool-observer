import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { collect } from "../src/collector.mjs";
import { acquireLease, openStateDatabase, releaseLease } from "../src/db.mjs";
import { buildReport } from "../src/report.mjs";
import { fixtureConfig, temporaryRoot, writeJsonl } from "./helpers.mjs";

test("repeat collection is idempotent and cannot infer retirement", () => {
  const root = temporaryRoot();
  try {
    const { config, paths } = fixtureConfig(root, { ATO_DISABLE_PROVIDERS: "zcode" });
    const now = Date.parse("2026-08-21T12:00:00.000Z");
    const codexFile = path.join(paths.codex, "rollout.jsonl");
    writeJsonl(codexFile, [
      { timestamp: "2026-08-21T10:00:00.000Z", type: "session_meta", payload: { id: "s1" } },
      { timestamp: "2026-08-21T10:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", call_id: "c1", name: "exec", status: "completed", input: "await tools.mcp__math_anchor__math_run({});" } }
    ]);
    const claudeFile = path.join(paths.claude, "session.jsonl");
    writeJsonl(claudeFile, [
      { timestamp: "2026-08-21T10:00:00.000Z", type: "assistant", sessionId: "s2", uuid: "u1", message: { id: "m1", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "secret" } }] } },
      { timestamp: "2026-08-21T10:00:00.100Z", type: "user", sessionId: "s2", uuid: "u2", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "secret" }] } }
    ]);
    const beforeCodex = fs.readFileSync(codexFile);
    const beforeClaude = fs.readFileSync(claudeFile);
    const database = openStateDatabase(config);
    const first = collect(database, config, now);
    assert.equal(first.status, "completed");
    const countsAfterFirst = {
      tools: database.prepare("SELECT count(*) AS n FROM tool_event").get().n,
      usage: database.prepare("SELECT count(*) AS n FROM usage_event").get().n
    };
    collect(database, config, now + 1000);
    assert.deepEqual({
      tools: database.prepare("SELECT count(*) AS n FROM tool_event").get().n,
      usage: database.prepare("SELECT count(*) AS n FROM usage_event").get().n
    }, countsAfterFirst);
    const report = buildReport(database, { days: 30 }, now + 1000);
    assert.deepEqual(report.portfolio.retireCandidates, []);
    assert.deepEqual(report.portfolio.weakenRoutingCandidates, []);
    assert.equal(report.tools.every((tool) => tool.correctnessEvidence === "unknown"), true);
    database.close();
    assert.deepEqual(fs.readFileSync(codexFile), beforeCodex);
    assert.deepEqual(fs.readFileSync(claudeFile), beforeClaude);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runtime errors need measured evidence before fix-candidate", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const database = openStateDatabase(config);
    const insert = database.prepare(`
      INSERT INTO tool_event(
        event_id, provider, occurred_at_ms, tool_name, route_class, is_openadam,
        derived, status, source_format, recorded_at_ms
      ) VALUES (?, 'claude', ?, 'mcp__math_anchor__math_run', 'mcp', 1, 0, ?, 'test', ?)
    `);
    const now = Date.now();
    for (let index = 0; index < 4; index += 1) insert.run(`e${index}`, now, "error", now);
    let report = buildReport(database, { days: 1, openAdamOnly: true }, now);
    assert.equal(report.tools[0].signal, "insufficient-data");
    insert.run("e4", now, "completed", now);
    report = buildReport(database, { days: 1, openAdamOnly: true }, now);
    assert.equal(report.tools[0].signal, "fix-candidate");
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an active collector lease prevents overlapping automatic scans", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const database = openStateDatabase(config);
    const first = acquireLease(database, 60_000, 1000);
    assert.equal(typeof first, "string");
    assert.equal(acquireLease(database, 60_000, 1001), null);
    releaseLease(database, first);
    assert.equal(typeof acquireLease(database, 60_000, 1002), "string");
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("state database refuses a symlink target", () => {
  const root = temporaryRoot();
  try {
    const { config, paths } = fixtureConfig(root);
    fs.mkdirSync(paths.state, { recursive: true, mode: 0o700 });
    const outside = path.join(root, "outside.sqlite");
    fs.writeFileSync(outside, "not a database");
    fs.symlinkSync(outside, config.databasePath);
    assert.throws(() => openStateDatabase(config), { code: "STATE_FILE_INVALID" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("schema migration discards stale derived Codex projections and reopens their cursors", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    let database = openStateDatabase(config);
    const now = Date.now();
    database.prepare("UPDATE metadata SET value = '1' WHERE key = 'schema_version'").run();
    database.prepare(`
      INSERT INTO tool_event(
        event_id, provider, source_id, occurred_at_ms, tool_name, route_class,
        is_openadam, derived, status, source_format, recorded_at_ms
      ) VALUES ('derived', 'codex', 'source', ?, 'mcp__x__y', 'mcp', 0, 1, 'observed', 'test', ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO source_cursor(
        source_id, provider, file_identity, offset_bytes, size_bytes, mtime_ms,
        discarding_line, skipped_lines, updated_at_ms
      ) VALUES ('source', 'codex', 'identity', 1, 1, ?, 0, 0, ?)
    `).run(now, now);
    database.close();

    database = openStateDatabase(config);
    assert.equal(database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "6");
    assert.equal(database.prepare("SELECT count(*) AS n FROM tool_event WHERE event_id = 'derived'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM source_cursor WHERE source_id = 'source'").get().n, 0);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("schema v3 migration purges corrupted Codex rollups for clean re-ingestion", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    let database = openStateDatabase(config);
    const now = Date.now();
    database.prepare("UPDATE metadata SET value = '3' WHERE key = 'schema_version'").run();
    for (const [eventId, provider] of [["codex-old", "codex"], ["claude-keep", "claude"]]) {
      database.prepare(`
        INSERT INTO tool_event(
          event_id, provider, occurred_at_ms, tool_name, route_class, is_openadam,
          derived, status, source_format, recorded_at_ms
        ) VALUES (?, ?, ?, 'Bash', 'native-shell', 0, 0, 'observed', 'test', ?)
      `).run(eventId, provider, now, now);
    }
    database.prepare(`
      INSERT INTO usage_event(
        event_id, provider, occurred_at_ms, input_tokens, output_tokens,
        source_format, recorded_at_ms
      ) VALUES ('codex-usage-old', 'codex', ?, 10, 2, 'test', ?)
    `).run(now, now);
    database.prepare(`
      INSERT INTO source_cursor(
        source_id, provider, file_identity, offset_bytes, size_bytes, mtime_ms,
        discarding_line, skipped_lines, updated_at_ms
      ) VALUES ('codex-source', 'codex', 'identity', 1, 1, ?, 0, 0, ?)
    `).run(now, now);
    database.close();

    database = openStateDatabase(config);
    assert.equal(database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "6");
    assert.equal(database.prepare("SELECT count(*) AS n FROM tool_event WHERE provider = 'codex'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM usage_event WHERE provider = 'codex'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM source_cursor WHERE provider = 'codex'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM tool_event WHERE provider = 'claude'").get().n, 1);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("schema v4 migration repairs stored tool taxonomy without deleting observations", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    let database = openStateDatabase(config);
    const now = Date.now();
    database.prepare("UPDATE metadata SET value = '4' WHERE key = 'schema_version'").run();
    database.prepare(`
      INSERT INTO tool_event(
        event_id, provider, occurred_at_ms, tool_name, route_class, is_openadam,
        derived, status, source_format, recorded_at_ms
      ) VALUES ('reclassify', 'claude', ?, 'mcp__data-transformer__data_transform',
        'unknown', 0, 0, 'completed', 'test', ?)
    `).run(now, now);
    database.close();

    database = openStateDatabase(config);
    const row = { ...database.prepare(`
      SELECT tool_namespace, route_class, is_openadam
      FROM tool_event WHERE event_id = 'reclassify'
    `).get() };
    assert.equal(database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "6");
    assert.deepEqual(row, {
      tool_namespace: "data_transformer",
      route_class: "mcp",
      is_openadam: 1
    });
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("schema v5 migration adds the bounded ZCode tie cursor", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    let database = openStateDatabase(config);
    database.exec("ALTER TABLE provider_checkpoint DROP COLUMN last_started_count");
    database.prepare("UPDATE metadata SET value = '5' WHERE key = 'schema_version'").run();
    database.close();

    database = openStateDatabase(config);
    const columns = database.prepare("PRAGMA table_info(provider_checkpoint)").all().map((row) => row.name);
    assert.equal(database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, "6");
    assert.equal(columns.includes("last_started_count"), true);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
