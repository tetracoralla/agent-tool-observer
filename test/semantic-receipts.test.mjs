import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { openStateDatabase, putToolEvent } from "../src/db.mjs";
import { buildReport } from "../src/report.mjs";
import { ingestProcedureReceipts, projectProcedureReceipt } from "../src/semantic-receipts.mjs";
import { fixtureConfig, temporaryRoot } from "./helpers.mjs";

function receipt(invocationId = "private-invocation") {
  const startedAt = "2026-08-22T02:00:00.000Z";
  const completedAt = "2026-08-22T02:00:00.100Z";
  return {
    schemaVersion: "openadam.procedure-receipt.v0.1",
    procedureId: "org.openadam.brand-asset.prepare",
    procedureVersion: "0.1.0",
    invocationId,
    implementation: { id: "org.openadam.brand-asset-prep", version: "0.1.0" },
    outcome: "success",
    startedAt,
    completedAt,
    inputDigest: `sha256:${"a".repeat(64)}`,
    outputDigest: `sha256:${"b".repeat(64)}`,
    stages: [
      {
        stageId: "trim-transparent",
        status: "success",
        capability: {
          id: "org.openadam.raster.prepare",
          version: "0.1.0",
          operationId: "trim-transparent"
        },
        provider: { id: "org.openadam.asset-prep", version: "0.1.0" },
        binding: { transport: "mcp-tool", target: "raster_trim_transparent" },
        durationMs: 40,
        effects: ["write"]
      },
      {
        stageId: "render-projective",
        status: "skipped",
        capability: {
          id: "org.openadam.projective.transform",
          version: "0.1.0",
          operationId: "render"
        },
        provider: { id: "io.github.tetracoralla.projective", version: "0.1.0" },
        binding: { transport: "mcp-tool", target: "projective.render" },
        durationMs: 0,
        effects: ["none"]
      }
    ]
  };
}

function reviewReceipt(status, invocationId = `private-review-${status}`) {
  const successful = status === "accepted";
  const startedAt = "2026-08-22T02:10:00.000Z";
  const completedAt = "2026-08-22T02:10:00.100Z";
  const value = {
    schemaVersion: "openadam.procedure-receipt.v0.2",
    procedureId: "org.openadam.structured-data.import-review",
    procedureVersion: "0.1.0",
    invocationId,
    implementation: { id: "org.openadam.structured-data-preflight", version: "0.1.0" },
    outcome: successful ? "success" : status === "pending" ? "blocked" : "rejected",
    startedAt,
    completedAt,
    inputDigest: `sha256:${"a".repeat(64)}`,
    stages: [
      {
        kind: "capability",
        stageId: "inspect-file",
        status: "success",
        capability: {
          id: "org.openadam.file.inspect",
          version: "0.1.0",
          operationId: "inspect"
        },
        provider: { id: "io.github.tetracoralla.universal-inspector", version: "0.1.0" },
        binding: { transport: "mcp-tool", target: "file_inspect" },
        durationMs: 40,
        effects: ["read"]
      },
      {
        kind: "human-checkpoint",
        stageId: "import-acceptance",
        status,
        authority: "human",
        criteriaDigest: `sha256:${"b".repeat(64)}`,
        durationMs: 0,
        effects: ["none"]
      }
    ]
  };
  if (successful) value.outputDigest = `sha256:${"c".repeat(64)}`;
  else value.error = {
    code: status === "pending" ? "REVIEW_REQUIRED" : "REVIEW_REJECTED",
    message: "Review did not complete successfully."
  };
  if (status === "accepted" || status === "rejected") {
    value.stages[1].decision = {
      source: "human",
      recordedAt: completedAt,
      evidenceDigests: [`sha256:${"d".repeat(64)}`]
    };
  }
  return value;
}

test("semantic receipt ingestion is bounded, idempotent, and metadata-only", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const file = path.join(root, "receipt.json");
    fs.writeFileSync(file, JSON.stringify({ receipt: receipt() }), { mode: 0o600 });
    const database = openStateDatabase(config);
    const first = ingestProcedureReceipts(database, file);
    const second = ingestProcedureReceipts(database, file);

    assert.deepEqual(
      { procedures: first.proceduresWritten, stages: first.capabilityStagesWritten },
      { procedures: 1, stages: 2 }
    );
    assert.deepEqual(
      { procedures: second.proceduresWritten, stages: second.capabilityStagesWritten },
      { procedures: 0, stages: 0 }
    );
    const stored = database.prepare("SELECT * FROM procedure_event").get();
    assert.notEqual(stored.invocation_hash, "private-invocation");
    assert.equal(JSON.stringify(stored).includes("private-invocation"), false);
    assert.equal(database.prepare("SELECT count(*) AS n FROM capability_event").get().n, 2);

    putToolEvent(database, {
      eventId: "mapped-passive-call",
      provider: "codex",
      sessionHash: "mapped-session",
      turnHash: "mapped-turn",
      callHash: "mapped-call",
      occurredAtMs: Date.parse("2026-08-22T02:30:00Z"),
      toolName: "mcp__asset_prep__raster_trim_transparent",
      routeClass: "mcp",
      isOpenAdam: true,
      derived: false,
      status: "completed",
      sourceFormat: "test",
      recordedAtMs: Date.parse("2026-08-22T02:30:00Z")
    });

    const report = buildReport(database, { days: 2 }, Date.parse("2026-08-22T03:00:00Z"));
    assert.equal(report.procedures[0].procedureId, "org.openadam.brand-asset.prepare");
    assert.equal(report.procedures[0].correctnessEvidence, "unknown");
    assert.equal(report.capabilities.length, 2);
    assert.equal(report.capabilities.every((item) => item.correctnessEvidence === "unknown"), true);
    const trim = report.capabilities.find((item) => item.operationId === "trim-transparent");
    assert.equal(trim.passiveObservedCalls, 1);
    assert.equal(trim.passiveMappingBasis, "declared-receipt-binding-target");
    assert.equal(report.portfolio.capabilityCandidates.some(
      (item) => item.toolName === "mcp__asset_prep__raster_trim_transparent"
    ), false);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid or symlinked receipt sources fail without persistence", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const invalidFile = path.join(root, "invalid.json");
    fs.writeFileSync(invalidFile, JSON.stringify({ ...receipt(), procedureId: "raw/private/path" }));
    const symlink = path.join(root, "linked.json");
    fs.symlinkSync(invalidFile, symlink);
    const database = openStateDatabase(config);
    assert.throws(() => ingestProcedureReceipts(database, invalidFile), { code: "RECEIPT_INVALID" });
    assert.throws(() => ingestProcedureReceipts(database, symlink), { code: "RECEIPT_FILE_INVALID" });
    assert.equal(database.prepare("SELECT count(*) AS n FROM procedure_event").get().n, 0);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("report nominates repeated unmapped tools and repeated sequences without claiming correctness", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const database = openStateDatabase(config);
    const now = Date.parse("2026-08-22T03:00:00Z");
    for (let index = 0; index < 5; index += 1) {
      putToolEvent(database, {
        eventId: `unmapped-${index}`,
        provider: "codex",
        sessionHash: `session-${index % 2}`,
        turnHash: `unmapped-turn-${index}`,
        callHash: `unmapped-call-${index}`,
        occurredAtMs: now + index,
        toolName: "mcp__unknown__micro_action",
        routeClass: "mcp",
        isOpenAdam: false,
        derived: false,
        status: "completed",
        sourceFormat: "test",
        recordedAtMs: now
      });
    }
    for (let turn = 0; turn < 3; turn += 1) {
      for (const [position, toolName] of ["mcp__alpha__inspect", "mcp__beta__convert"].entries()) {
        putToolEvent(database, {
          eventId: `sequence-${turn}-${position}`,
          provider: "codex",
          sessionHash: `sequence-session-${turn % 2}`,
          turnHash: `sequence-turn-${turn}`,
          callHash: `sequence-call-${turn}-${position}`,
          occurredAtMs: now + 100 + turn * 10 + position,
          toolName,
          routeClass: "mcp",
          isOpenAdam: false,
          derived: false,
          status: "completed",
          sourceFormat: "test",
          recordedAtMs: now
        });
      }
    }
    const report = buildReport(database, { days: 1 }, now + 1000);
    assert.equal(report.portfolio.capabilityCandidates.some(
      (item) => item.toolName === "mcp__unknown__micro_action"
    ), true);
    assert.deepEqual(report.portfolio.procedureCandidates[0].sequence, [
      "mcp__alpha__inspect",
      "mcp__beta__convert"
    ]);
    assert.equal(report.portfolio.procedureCandidates[0].correctnessEvidence, "unknown");
    assert.deepEqual(report.portfolio.retireCandidates, []);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("receipt projection accepts sub-millisecond ISO timestamps and hashes identity", () => {
  const value = receipt("private-id");
  value.completedAt = "2026-08-22T02:00:00.123456Z";
  const projected = projectProcedureReceipt(value);
  assert.equal(projected.invocationHash.length, 64);
  assert.notEqual(projected.invocationHash, "private-id");
});

test("v0.2 human checkpoints are stored as bounded metadata without review evidence", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const file = path.join(root, "review-receipt.json");
    fs.writeFileSync(file, JSON.stringify(reviewReceipt("accepted")), { mode: 0o600 });
    const database = openStateDatabase(config);
    const result = ingestProcedureReceipts(database, file);

    assert.equal(result.proceduresWritten, 1);
    assert.equal(result.capabilityStagesWritten, 1);
    assert.equal(result.humanCheckpointsWritten, 1);
    assert.equal(database.prepare("SELECT count(*) AS n FROM capability_event").get().n, 1);
    const checkpoint = database.prepare("SELECT * FROM human_checkpoint_event").get();
    assert.equal(checkpoint.status, "accepted");
    assert.equal(checkpoint.authority, "human");
    assert.equal(checkpoint.decision_source, "human");
    assert.equal(JSON.stringify(checkpoint).includes("sha256:"), false);

    const report = buildReport(database, { days: 2 }, Date.parse("2026-08-22T03:00:00Z"));
    assert.deepEqual(report.humanCheckpoints[0].decisions, {
      pending: 0,
      accepted: 1,
      rejected: 0,
      skipped: 0
    });
    assert.equal(report.humanCheckpoints[0].authorityEvidence, "declared-human-source");
    assert.equal(report.humanCheckpoints[0].identityAuthentication, "host-required");
    assert.equal(report.humanCheckpoints[0].correctnessEvidence, "unknown");
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("human rejection remains distinct from runtime error in reports", () => {
  const root = temporaryRoot();
  try {
    const { config } = fixtureConfig(root);
    const file = path.join(root, "rejected-review.json");
    fs.writeFileSync(file, JSON.stringify(reviewReceipt("rejected")), { mode: 0o600 });
    const database = openStateDatabase(config);
    ingestProcedureReceipts(database, file);

    const report = buildReport(database, { days: 2 }, Date.parse("2026-08-22T03:00:00Z"));
    assert.equal(report.procedures[0].runtime.errors, 0);
    assert.equal(report.procedures[0].runtime.rejected, 1);
    assert.equal(report.humanCheckpoints[0].decisions.rejected, 1);
    database.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an Agent decision source cannot satisfy a v0.2 human checkpoint", () => {
  const value = reviewReceipt("accepted");
  value.stages[1].decision.source = "agent";
  assert.throws(() => projectProcedureReceipt(value), { code: "RECEIPT_INVALID" });
});
