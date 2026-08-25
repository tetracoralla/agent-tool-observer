import fs from "node:fs";
import { eventIdentifier, hashIdentifier } from "./core/hash.mjs";
import { putProcedureReceipt } from "./db.mjs";
import { ObserverError } from "./errors.mjs";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_RECEIPTS = 1000;
const stableId = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const errorCode = /^[A-Z][A-Z0-9_]*$/;
const outcomesV01 = new Set(["success", "error", "blocked"]);
const outcomesV02 = new Set(["success", "error", "blocked", "rejected"]);
const capabilityStatuses = new Set(["success", "error", "skipped"]);
const transports = new Set(["mcp-tool", "cli", "library", "http", "native-function"]);
const effects = new Set(["none", "read", "write", "destructive", "network", "model"]);

function invalid(message) {
  throw new ObserverError("RECEIPT_INVALID", message);
}

function exactObject(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function assertStableId(value, label, maximum = 160) {
  if (typeof value !== "string" || value.length > maximum || !stableId.test(value)) {
    invalid(`${label} is invalid`);
  }
}

function assertVersion(value, label) {
  if (typeof value !== "string" || value.length > 64 || !semver.test(value)) {
    invalid(`${label} is invalid`);
  }
}

function dateMs(value, label) {
  if (typeof value !== "string" || value.length > 100 || !value.includes("T")
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid(`${label} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid(`${label} is invalid`);
  return parsed;
}

function errorValue(value, label) {
  if (!exactObject(value, ["code", "message"])) invalid(`${label} is invalid`);
  if (typeof value.code !== "string" || value.code.length > 100 || !errorCode.test(value.code)) {
    invalid(`${label} code is invalid`);
  }
  if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 1000) {
    invalid(`${label} message is invalid`);
  }
  return value.code;
}

function projectCapabilityStage(stage, index, receiptEventId, requireKind) {
  if (!exactObject(
    stage,
    [
      ...(requireKind ? ["kind"] : []),
      "stageId", "status", "capability", "provider", "binding", "durationMs", "effects"
    ],
    ["error"]
  )) invalid("stage receipt fields are invalid");
  if (requireKind && stage.kind !== "capability") invalid("stage kind is invalid");
  assertStableId(stage.stageId, "stageId");
  if (!capabilityStatuses.has(stage.status)) invalid("stage status is invalid");
  if (!exactObject(stage.capability, ["id", "version", "operationId"])) {
    invalid("stage capability is invalid");
  }
  assertStableId(stage.capability.id, "capability id");
  assertVersion(stage.capability.version, "capability version");
  assertStableId(stage.capability.operationId, "operation id");
  if (!exactObject(stage.provider, ["id", "version"])) invalid("stage provider is invalid");
  assertStableId(stage.provider.id, "provider id");
  assertVersion(stage.provider.version, "provider version");
  if (!exactObject(stage.binding, ["transport", "target"])) invalid("stage binding is invalid");
  if (!transports.has(stage.binding.transport)) invalid("stage transport is invalid");
  if (typeof stage.binding.target !== "string" || stage.binding.target.length < 1 || stage.binding.target.length > 300) {
    invalid("stage target is invalid");
  }
  if (!Number.isSafeInteger(stage.durationMs) || stage.durationMs < 0 || stage.durationMs > 86400000) {
    invalid("stage duration is invalid");
  }
  if (!Array.isArray(stage.effects) || stage.effects.length < 1 || stage.effects.length > 6
      || new Set(stage.effects).size !== stage.effects.length
      || stage.effects.some((value) => !effects.has(value))) {
    invalid("stage effects are invalid");
  }
  let stageErrorCode = null;
  if (stage.status === "error") {
    if (stage.error === undefined) invalid("error stage is missing its error");
    stageErrorCode = errorValue(stage.error, "stage error");
  } else if (stage.error !== undefined) {
    invalid("non-error stage contains an error");
  }
  return {
    eventId: eventIdentifier("semantic-receipt", "stage", receiptEventId, index),
    kind: "capability",
    index,
    stageId: stage.stageId,
    capabilityId: stage.capability.id,
    capabilityVersion: stage.capability.version,
    operationId: stage.capability.operationId,
    providerId: stage.provider.id,
    providerVersion: stage.provider.version,
    transport: stage.binding.transport,
    target: stage.binding.target,
    status: stage.status,
    durationMs: stage.durationMs,
    effects: [...stage.effects],
    errorCode: stageErrorCode
  };
}

function discardHumanCheckpoint(stage) {
  // Legacy v0.2 receipts may still carry human-checkpoint stages. The portable
  // approval semantics behind them were removed from the standards on
  // 2026-08-23, so only the entry shape is checked and nothing is persisted.
  if (stage === null || typeof stage !== "object" || Array.isArray(stage)
      || typeof stage.stageId !== "string" || stage.stageId.length < 1
      || stage.stageId.length > 160) {
    invalid("human checkpoint entry is malformed");
  }
  return null;
}

export function projectProcedureReceipt(value) {
  if (!exactObject(
    value,
    [
      "schemaVersion", "procedureId", "procedureVersion", "invocationId",
      "implementation", "outcome", "startedAt", "completedAt", "inputDigest", "stages"
    ],
    ["$schema", "outputDigest", "error"]
  )) invalid("receipt fields are invalid");
  if (!["openadam.procedure-receipt.v0.1", "openadam.procedure-receipt.v0.2"]
    .includes(value.schemaVersion)) {
    invalid("receipt schemaVersion is unsupported");
  }
  const isV02 = value.schemaVersion === "openadam.procedure-receipt.v0.2";
  assertStableId(value.procedureId, "procedure id");
  assertVersion(value.procedureVersion, "procedure version");
  if (typeof value.invocationId !== "string" || value.invocationId.length < 1 || value.invocationId.length > 200) {
    invalid("invocationId is invalid");
  }
  if (!exactObject(value.implementation, ["id", "version"])) {
    invalid("implementation is invalid");
  }
  assertStableId(value.implementation.id, "implementation id");
  assertVersion(value.implementation.version, "implementation version");
  if (!(isV02 ? outcomesV02 : outcomesV01).has(value.outcome)) {
    invalid("receipt outcome is invalid");
  }
  const startedAtMs = dateMs(value.startedAt, "startedAt");
  const completedAtMs = dateMs(value.completedAt, "completedAt");
  if (completedAtMs < startedAtMs) invalid("receipt dates are reversed");
  if (!digest.test(value.inputDigest)) invalid("inputDigest is invalid");
  if (value.outcome === "success") {
    if (!digest.test(value.outputDigest ?? "") || value.error !== undefined) {
      invalid("successful receipt evidence is invalid");
    }
  } else if (value.outputDigest !== undefined || value.error === undefined) {
    invalid("unsuccessful receipt evidence is invalid");
  }
  const receiptErrorCode = value.error === undefined ? null : errorValue(value.error, "receipt error");
  if (!Array.isArray(value.stages) || value.stages.length < 1 || value.stages.length > 64) {
    invalid("receipt stages are invalid");
  }
  const eventId = eventIdentifier(
    "semantic-receipt",
    "procedure",
    value.procedureId,
    value.procedureVersion,
    value.implementation.id,
    value.invocationId,
    value.completedAt
  );
  let checkpointsDiscarded = 0;
  const stages = value.stages
    .map((stage, index) => {
      if (!isV02) return projectCapabilityStage(stage, index, eventId, false);
      if (stage?.kind === "capability") {
        return projectCapabilityStage(stage, index, eventId, true);
      }
      if (stage?.kind === "human-checkpoint") {
        checkpointsDiscarded += 1;
        return discardHumanCheckpoint(stage);
      }
      invalid("stage kind is invalid");
    })
    .filter((stage) => stage !== null);
  return {
    eventId,
    invocationHash: hashIdentifier("semantic-receipt:invocation", value.invocationId),
    procedureId: value.procedureId,
    procedureVersion: value.procedureVersion,
    implementationId: value.implementation.id,
    implementationVersion: value.implementation.version,
    outcome: value.outcome,
    startedAtMs,
    completedAtMs,
    durationMs: completedAtMs - startedAtMs,
    errorCode: receiptErrorCode,
    sourceFormat: value.schemaVersion,
    checkpointsDiscarded,
    stages
  };
}

function receiptValues(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const lines = text.split("\n").filter((line) => line.trim() !== "");
    if (lines.some((line) => Buffer.byteLength(line) > MAX_LINE_BYTES)) {
      throw new ObserverError("RECEIPT_LIMIT", "Receipt line exceeds its byte limit");
    }
    try {
      parsed = lines.map((line) => JSON.parse(line));
    } catch {
      throw new ObserverError("RECEIPT_INVALID", "Receipt file is not valid JSON or JSONL");
    }
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length < 1 || values.length > MAX_RECEIPTS) {
    throw new ObserverError("RECEIPT_LIMIT", "Receipt count is outside the fixed bound");
  }
  return values.map((item) => item?.receipt ?? item);
}

export function ingestProcedureReceipts(database, filePath, recordedAtMs = Date.now()) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ObserverError("RECEIPT_FILE_INVALID", "Receipt source must be a regular non-symlinked file");
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new ObserverError("RECEIPT_LIMIT", "Receipt source exceeds the fixed byte limit");
  }
  const projected = receiptValues(fs.readFileSync(filePath, "utf8")).map(projectProcedureReceipt);
  let proceduresWritten = 0;
  let stagesWritten = 0;
  let humanCheckpointsDiscarded = 0;
  for (const receipt of projected) {
    const result = putProcedureReceipt(database, receipt, recordedAtMs);
    proceduresWritten += result.proceduresWritten;
    stagesWritten += result.stagesWritten;
    humanCheckpointsDiscarded += receipt.checkpointsDiscarded;
  }
  return {
    status: "completed",
    receiptsRead: projected.length,
    proceduresWritten,
    capabilityStagesWritten: stagesWritten,
    humanCheckpointsDiscarded,
    rawContentStored: false,
    sourcePathStored: false,
    networkUsed: false,
    modelCalls: 0
  };
}
