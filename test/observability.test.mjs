import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { collect } from "../src/collector.mjs";
import { ingestContextSurfaceAnalysis } from "../src/context-surface.mjs";
import { openStateDatabase, putToolEvent } from "../src/db.mjs";
import { buildReport } from "../src/report.mjs";
import { fixtureConfig, temporaryRoot, writeJsonl } from "./helpers.mjs";

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function directObservation(overrides = {}) {
  return {
    schemaVersion: "openadam.direct-execution-observation.v0.1",
    eventId: digest("a"),
    workOrderHash: digest("b"),
    callHash: digest("c"),
    occurredAtMs: 1_777_000_000_000,
    completedAtMs: 1_777_000_000_012,
    target: {
      kind: "capability",
      capabilityId: "org.openadam.test.echo",
      capabilityVersion: "0.1.0",
      operationId: "echo"
    },
    provider: {
      id: "org.openadam.test-provider",
      version: "0.1.0",
      transport: "capability-jsonl-v0.1",
      lifecycle: "persistent"
    },
    status: "ok",
    errorCode: null,
    timingMs: { total: 12, queue: 1, providerRoundTrip: 8 },
    payloadBytes: { request: 17, response: 21 },
    sessionState: "cold",
    bindingDigest: digest("d"),
    contractDigest: digest("e"),
    execution: {
      modelCalls: 0,
      tokenUsage: null,
      monetaryCost: null,
      externalCostStatus: "not_observed"
    },
    ...overrides
  };
}

test("Direct Runtime metadata is collected idempotently without work-order content", () => {
  const root = temporaryRoot();
  try {
    const { config, paths } = fixtureConfig(root, { ATO_DISABLE_PROVIDERS: "codex,claude,zcode" });
    writeJsonl(paths.directRuntime, [directObservation()]);
    const database = openStateDatabase(config);
    const first = collect(database, config, 1_777_000_000_100);
    const second = collect(database, config, 1_777_000_000_200);
    assert.equal(first.semanticSources[0].status, "ok");
    assert.equal(first.semanticSources[0].eventsWritten, 1);
    assert.equal(second.semanticSources[0].eventsWritten, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM semantic_execution_event").get().n, 1);
    const stored = JSON.stringify(database.prepare("SELECT * FROM semantic_execution_event").get());
    assert.equal(stored.includes("work-order-private-input"), false);
    const report = buildReport(database, { days: 1 }, 1_777_000_000_200);
    assert.equal(report.semanticExecutions.length, 1);
    assert.equal(report.semanticExecutions[0].target.capabilityId, "org.openadam.test.echo");
    assert.equal(report.semanticExecutions[0].payload.requestBytes, 17);
    assert.equal(report.semanticExecutions[0].executionCost.modelCalls, 0);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Direct Runtime projected MCP operations retain carrier and operation identity", () => {
  const root = temporaryRoot();
  try {
    const { config, paths } = fixtureConfig(root, { ATO_DISABLE_PROVIDERS: "codex,claude,zcode" });
    writeJsonl(paths.directRuntime, [directObservation({
      eventId: digest("f"),
      target: {
        kind: "mcp-operation",
        toolName: "math.run",
        operationId: "calculus.derivative"
      },
      provider: {
        id: "io.github.tetracoralla.math-anchor",
        version: "0.3.0",
        transport: "mcp-stdio",
        lifecycle: "persistent"
      }
    })]);
    const database = openStateDatabase(config);
    const collected = collect(database, config, 1_777_000_000_100);
    assert.equal(collected.semanticSources[0].status, "ok");
    assert.equal(collected.semanticSources[0].eventsWritten, 1);
    const report = buildReport(database, { days: 1 }, 1_777_000_000_200);
    assert.deepEqual(report.semanticExecutions[0].target, {
      kind: "mcp-operation",
      toolName: "math.run",
      operationId: "calculus.derivative"
    });
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Direct Runtime observation drift fails closed before cursor advancement", () => {
  const root = temporaryRoot();
  try {
    const { config, paths } = fixtureConfig(root, { ATO_DISABLE_PROVIDERS: "codex,claude,zcode" });
    writeJsonl(paths.directRuntime, [{ ...directObservation(), unknown: true }]);
    const database = openStateDatabase(config);
    const result = collect(database, config, 1_777_000_000_100);
    assert.equal(result.semanticSources[0].status, "error");
    assert.equal(result.semanticSources[0].errorCode, "DIRECT_OBSERVATION_INVALID");
    assert.equal(database.prepare("SELECT count(*) AS n FROM semantic_execution_event").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM direct_runtime_cursor").get().n, 0);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Context Surface analysis import stores only bounded measurements and provenance", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const file = path.join(root, "analysis.json");
    const analysis = {
      format: "context-surface.analysis.v0.1",
      status: "ok",
      source: { id: "sample-plugin", revision: "1.0.0" },
      snapshot: { sha256: "a".repeat(64), canonicalUtf8Bytes: 828 },
      catalog: { sha256: "b".repeat(64), canonicalUtf8Bytes: 410, largestToolUtf8Bytes: 205 },
      counts: { tools: 2, schemas: 2, describedTools: 2, tokenMeasurements: 1 },
      tools: [{ name: "must-not-store" }],
      exactDuplicateSchemas: [{ sha256: "c".repeat(64) }],
      hardNameCollisions: [],
      budgetChecks: [],
      tokenMeasurements: [{
        metric: "input_tokens",
        value: 412,
        source: "external-counter",
        provider: "example-provider",
        model: "example-model",
        serialization: "tools-list-json",
        tokenizerVersion: "example-1"
      }],
      measurementPolicy: "reported-only; no byte-to-token inference"
    };
    fs.writeFileSync(file, JSON.stringify(analysis), { mode: 0o600 });
    const database = openStateDatabase(config);
    const first = ingestContextSurfaceAnalysis(database, file, 1000);
    const second = ingestContextSurfaceAnalysis(database, file, 2000);
    assert.equal(first.measurementsWritten, 1);
    assert.equal(second.measurementsWritten, 0);
    const stored = JSON.stringify(database.prepare("SELECT * FROM context_surface_measurement").get());
    assert.equal(stored.includes("must-not-store"), false);
    const report = buildReport(database, { days: 1 }, 3000);
    assert.equal(report.contextSurfaces[0].catalog.canonicalUtf8Bytes, 410);
    assert.equal(report.contextSurfaces[0].tokenMeasurements[0].model, "example-model");
    assert.equal(report.contextSurfaces[0].currentInstalledBindingStatus, "not_assessed");
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("orchestration wrappers and derived nested calls cannot nominate a Procedure", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const database = openStateDatabase(config);
    const now = Date.now();
    for (let turn = 0; turn < 4; turn += 1) {
      for (const [position, event] of [
        { toolName: "exec", routeClass: "orchestration", derived: false },
        { toolName: "exec_command", routeClass: "orchestration", derived: true },
        { toolName: "mcp__math_anchor__math_run", routeClass: "mcp", derived: true }
      ].entries()) {
        putToolEvent(database, {
          eventId: `wrapper-${turn}-${position}`,
          provider: "codex",
          sessionHash: `session-${turn % 2}`,
          turnHash: `turn-${turn}`,
          callHash: `call-${turn}-${position}`,
          occurredAtMs: now + turn * 10 + position,
          ...event,
          isOpenAdam: event.toolName.includes("math_anchor"),
          status: "completed",
          sourceFormat: "test",
          recordedAtMs: now
        });
      }
    }
    const report = buildReport(database, { days: 1 }, now + 1000);
    assert.deepEqual(report.portfolio.procedureCandidates, []);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
