import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { classifyTool } from "./core/classify.mjs";
import { ObserverError } from "./errors.mjs";

const SCHEMA_VERSION = "8";

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS source_cursor (
  source_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  file_identity TEXT NOT NULL,
  offset_bytes INTEGER NOT NULL CHECK (offset_bytes >= 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms INTEGER NOT NULL CHECK (mtime_ms >= 0),
  discarding_line INTEGER NOT NULL DEFAULT 0 CHECK (discarding_line IN (0, 1)),
  skipped_lines INTEGER NOT NULL DEFAULT 0 CHECK (skipped_lines >= 0),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS provider_checkpoint (
  provider TEXT NOT NULL CHECK (provider IN ('zcode')),
  stream TEXT NOT NULL CHECK (stream IN ('tool_usage', 'model_usage')),
  source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) = 64),
  last_started_at_ms INTEGER NOT NULL CHECK (last_started_at_ms >= 0),
  last_started_count INTEGER NOT NULL DEFAULT 0 CHECK (last_started_count >= 0),
  last_scan_at_ms INTEGER NOT NULL CHECK (last_scan_at_ms >= 0),
  PRIMARY KEY(provider, stream)
) STRICT;

CREATE TABLE IF NOT EXISTS tool_event (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'zcode')),
  source_id TEXT,
  session_hash TEXT,
  turn_hash TEXT,
  call_hash TEXT,
  occurred_at_ms INTEGER CHECK (occurred_at_ms IS NULL OR occurred_at_ms >= 0),
  completed_at_ms INTEGER CHECK (completed_at_ms IS NULL OR completed_at_ms >= 0),
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 256),
  tool_namespace TEXT CHECK (tool_namespace IS NULL OR length(tool_namespace) BETWEEN 1 AND 128),
  route_class TEXT NOT NULL CHECK (route_class IN ('mcp', 'native-shell', 'host-builtin', 'orchestration', 'unknown')),
  is_openadam INTEGER NOT NULL CHECK (is_openadam IN (0, 1)),
  derived INTEGER NOT NULL DEFAULT 0 CHECK (derived IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('observed', 'completed', 'error', 'cancelled', 'unknown')),
  duration_ms REAL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  retry_count INTEGER CHECK (retry_count IS NULL OR retry_count >= 0),
  source_format TEXT NOT NULL CHECK (length(source_format) BETWEEN 1 AND 64),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS tool_event_time_idx ON tool_event(occurred_at_ms);
CREATE INDEX IF NOT EXISTS tool_event_tool_idx ON tool_event(tool_name, occurred_at_ms);
CREATE INDEX IF NOT EXISTS tool_event_provider_idx ON tool_event(provider, occurred_at_ms);
CREATE INDEX IF NOT EXISTS tool_event_openadam_idx ON tool_event(is_openadam, occurred_at_ms);

CREATE TABLE IF NOT EXISTS usage_event (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'zcode')),
  session_hash TEXT,
  turn_hash TEXT,
  occurred_at_ms INTEGER CHECK (occurred_at_ms IS NULL OR occurred_at_ms >= 0),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reasoning_tokens INTEGER CHECK (reasoning_tokens IS NULL OR reasoning_tokens >= 0),
  total_tokens INTEGER CHECK (total_tokens IS NULL OR total_tokens >= 0),
  duration_ms REAL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  source_format TEXT NOT NULL CHECK (length(source_format) BETWEEN 1 AND 64),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS usage_event_time_idx ON usage_event(occurred_at_ms);
CREATE INDEX IF NOT EXISTS usage_event_provider_idx ON usage_event(provider, occurred_at_ms);

CREATE TABLE IF NOT EXISTS procedure_event (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 64),
  invocation_hash TEXT NOT NULL CHECK (length(invocation_hash) = 64),
  procedure_id TEXT NOT NULL CHECK (length(procedure_id) BETWEEN 1 AND 160),
  procedure_version TEXT NOT NULL CHECK (length(procedure_version) BETWEEN 1 AND 64),
  implementation_id TEXT NOT NULL CHECK (length(implementation_id) BETWEEN 1 AND 160),
  implementation_version TEXT NOT NULL CHECK (length(implementation_version) BETWEEN 1 AND 64),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'blocked')),
  receipt_outcome TEXT NOT NULL CHECK (receipt_outcome IN ('success', 'error', 'blocked', 'rejected')),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= started_at_ms),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  stage_count INTEGER NOT NULL CHECK (stage_count BETWEEN 1 AND 64),
  error_code TEXT,
  source_format TEXT NOT NULL CHECK (length(source_format) BETWEEN 1 AND 64),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS procedure_event_time_idx ON procedure_event(completed_at_ms);
CREATE INDEX IF NOT EXISTS procedure_event_procedure_idx ON procedure_event(procedure_id, completed_at_ms);

CREATE TABLE IF NOT EXISTS capability_event (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 64),
  procedure_event_id TEXT NOT NULL REFERENCES procedure_event(event_id) ON DELETE CASCADE,
  stage_index INTEGER NOT NULL CHECK (stage_index BETWEEN 0 AND 63),
  stage_id TEXT NOT NULL CHECK (length(stage_id) BETWEEN 1 AND 160),
  capability_id TEXT NOT NULL CHECK (length(capability_id) BETWEEN 1 AND 160),
  capability_version TEXT NOT NULL CHECK (length(capability_version) BETWEEN 1 AND 64),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 160),
  provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 160),
  provider_version TEXT NOT NULL CHECK (length(provider_version) BETWEEN 1 AND 64),
  transport TEXT NOT NULL CHECK (transport IN ('mcp-tool', 'cli', 'library', 'http', 'native-function')),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 300),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  effects TEXT NOT NULL CHECK (length(effects) BETWEEN 2 AND 256),
  error_code TEXT,
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  UNIQUE(procedure_event_id, stage_index)
) STRICT;

CREATE INDEX IF NOT EXISTS capability_event_time_idx ON capability_event(completed_at_ms);
CREATE INDEX IF NOT EXISTS capability_event_capability_idx ON capability_event(capability_id, operation_id, completed_at_ms);
CREATE INDEX IF NOT EXISTS capability_event_target_idx ON capability_event(target);

CREATE TABLE IF NOT EXISTS human_checkpoint_event (
  event_id TEXT PRIMARY KEY CHECK (length(event_id) = 64),
  procedure_event_id TEXT NOT NULL REFERENCES procedure_event(event_id) ON DELETE CASCADE,
  stage_index INTEGER NOT NULL CHECK (stage_index BETWEEN 0 AND 63),
  stage_id TEXT NOT NULL CHECK (length(stage_id) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'skipped')),
  authority TEXT NOT NULL CHECK (authority = 'human'),
  decision_source TEXT CHECK (decision_source IS NULL OR decision_source = 'human'),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  UNIQUE(procedure_event_id, stage_index)
) STRICT;

CREATE INDEX IF NOT EXISTS human_checkpoint_event_time_idx
  ON human_checkpoint_event(completed_at_ms);
CREATE INDEX IF NOT EXISTS human_checkpoint_event_stage_idx
  ON human_checkpoint_event(stage_id, completed_at_ms);

CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY CHECK (provider IN ('codex', 'claude', 'zcode')),
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'missing', 'error', 'disabled')),
  error_code TEXT,
  files_seen INTEGER NOT NULL DEFAULT 0 CHECK (files_seen >= 0),
  files_read INTEGER NOT NULL DEFAULT 0 CHECK (files_read >= 0),
  bytes_read INTEGER NOT NULL DEFAULT 0 CHECK (bytes_read >= 0),
  lines_read INTEGER NOT NULL DEFAULT 0 CHECK (lines_read >= 0),
  events_written INTEGER NOT NULL DEFAULT 0 CHECK (events_written >= 0),
  skipped_lines INTEGER NOT NULL DEFAULT 0 CHECK (skipped_lines >= 0),
  backlog_sources INTEGER NOT NULL DEFAULT 0 CHECK (backlog_sources >= 0),
  scanned_at_ms INTEGER NOT NULL CHECK (scanned_at_ms >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS collection_run (
  run_id TEXT PRIMARY KEY,
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  completed_at_ms INTEGER CHECK (completed_at_ms IS NULL OR completed_at_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'skipped', 'error')),
  providers_ok INTEGER NOT NULL DEFAULT 0 CHECK (providers_ok >= 0),
  providers_partial INTEGER NOT NULL DEFAULT 0 CHECK (providers_partial >= 0),
  providers_missing INTEGER NOT NULL DEFAULT 0 CHECK (providers_missing >= 0),
  providers_error INTEGER NOT NULL DEFAULT 0 CHECK (providers_error >= 0),
  events_written INTEGER NOT NULL DEFAULT 0 CHECK (events_written >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS collector_lease (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)
) STRICT;
`;

function ensureOwnerDirectory(directory) {
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ObserverError("STATE_DIR_INVALID", "Observer state directory must be a real directory");
  }
  if (!existed) fs.chmodSync(directory, 0o700);
  if ((stat.mode & 0o077) !== 0) {
    throw new ObserverError("STATE_DIR_PERMISSIONS", "Observer state directory must not be accessible by group or other users");
  }
}

function reclassifyStoredTools(database) {
  const update = database.prepare(`
    UPDATE tool_event
    SET tool_namespace = ?, route_class = ?, is_openadam = ?
    WHERE event_id = ?
  `);
  for (const row of database.prepare("SELECT event_id, tool_name FROM tool_event").all()) {
    const classified = classifyTool(row.tool_name);
    update.run(classified.namespace, classified.routeClass, classified.isOpenAdam ? 1 : 0, row.event_id);
  }
}

export function openStateDatabase(config) {
  ensureOwnerDirectory(config.stateDir);
  ensureOwnerDirectory(config.logsDir);
  const databaseExisted = fs.existsSync(config.databasePath);
  for (const candidate of [config.databasePath, `${config.databasePath}-wal`, `${config.databasePath}-shm`]) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ObserverError("STATE_FILE_INVALID", "Observer state files must be regular non-symlinked files");
    }
  }
  const database = new DatabaseSync(config.databasePath);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
  database.exec(SCHEMA_SQL);
  const storedVersion = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value;
  if (storedVersion === undefined) {
    database.prepare("INSERT INTO metadata(key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
  } else if (["1", "2", "3", "4", "5", "6", "7"].includes(storedVersion)) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const checkpointColumns = new Set(
        database.prepare("PRAGMA table_info(provider_checkpoint)").all().map((row) => row.name)
      );
      if (!checkpointColumns.has("last_started_count")) {
        database.exec(`
          ALTER TABLE provider_checkpoint
          ADD COLUMN last_started_count INTEGER NOT NULL DEFAULT 0 CHECK (last_started_count >= 0)
        `);
      }
      const procedureColumns = new Set(
        database.prepare("PRAGMA table_info(procedure_event)").all().map((row) => row.name)
      );
      if (!procedureColumns.has("receipt_outcome")) {
        database.exec(`
          ALTER TABLE procedure_event
          ADD COLUMN receipt_outcome TEXT
          CHECK (receipt_outcome IS NULL OR receipt_outcome IN ('success', 'error', 'blocked', 'rejected'))
        `);
        database.prepare("UPDATE procedure_event SET receipt_outcome = outcome").run();
      }
      if (["1", "2", "3"].includes(storedVersion)) {
        database.prepare("DELETE FROM tool_event WHERE provider = 'codex'").run();
        database.prepare("DELETE FROM usage_event WHERE provider = 'codex'").run();
        database.prepare("DELETE FROM source_cursor WHERE provider = 'codex'").run();
      }
      reclassifyStoredTools(database);
      database.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(SCHEMA_VERSION);
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      database.close();
      throw error;
    }
  } else if (storedVersion !== SCHEMA_VERSION) {
    database.close();
    throw new ObserverError("SCHEMA_VERSION_UNSUPPORTED", "Observer database schema version is not supported");
  }
  if (!databaseExisted) fs.chmodSync(config.databasePath, 0o600);
  const databaseMode = fs.lstatSync(config.databasePath).mode;
  if ((databaseMode & 0o077) !== 0) {
    database.close();
    throw new ObserverError("STATE_FILE_PERMISSIONS", "Observer database must not be accessible by group or other users");
  }
  for (const suffix of ["-wal", "-shm"]) {
    const candidate = `${config.databasePath}${suffix}`;
    if (!fs.existsSync(candidate)) continue;
    if (!databaseExisted) fs.chmodSync(candidate, 0o600);
    if ((fs.lstatSync(candidate).mode & 0o077) !== 0) {
      database.close();
      throw new ObserverError("STATE_FILE_PERMISSIONS", "Observer database sidecars must not be accessible by group or other users");
    }
  }
  return database;
}

export function openReadOnlyStateDatabase(config) {
  if (!fs.existsSync(config.databasePath)) {
    throw new ObserverError("STATE_DATABASE_MISSING", "Observer database does not exist yet");
  }
  const stat = fs.lstatSync(config.databasePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new ObserverError("STATE_FILE_INVALID", "Observer database must be an owner-only regular non-symlinked file");
  }
  const database = new DatabaseSync(config.databasePath, { readOnly: true });
  database.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 2000;");
  return database;
}

export function closeDatabase(database) {
  if (database?.isOpen) database.close();
}

export function getCursor(database, sourceId) {
  return database.prepare("SELECT * FROM source_cursor WHERE source_id = ?").get(sourceId) ?? null;
}

export function putCursor(database, cursor) {
  database.prepare(`
    INSERT INTO source_cursor(
      source_id, provider, file_identity, offset_bytes, size_bytes, mtime_ms,
      discarding_line, skipped_lines, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      provider = excluded.provider,
      file_identity = excluded.file_identity,
      offset_bytes = excluded.offset_bytes,
      size_bytes = excluded.size_bytes,
      mtime_ms = excluded.mtime_ms,
      discarding_line = excluded.discarding_line,
      skipped_lines = source_cursor.skipped_lines + excluded.skipped_lines,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    cursor.sourceId,
    cursor.provider,
    cursor.fileIdentity,
    cursor.offsetBytes,
    cursor.sizeBytes,
    Math.max(0, Math.round(cursor.mtimeMs)),
    cursor.discardingLine ? 1 : 0,
    cursor.skippedLines,
    cursor.updatedAtMs
  );
}

export function getProviderCheckpoint(database, provider, stream, sourceFingerprint) {
  const checkpoint = database.prepare(`
    SELECT last_started_at_ms, last_started_count, last_scan_at_ms
    FROM provider_checkpoint
    WHERE provider = ? AND stream = ? AND source_fingerprint = ?
  `).get(provider, stream, sourceFingerprint);
  return checkpoint ? {
    lastStartedAtMs: Number(checkpoint.last_started_at_ms),
    lastStartedCount: Number(checkpoint.last_started_count),
    lastScanAtMs: Number(checkpoint.last_scan_at_ms)
  } : null;
}

export function putProviderCheckpoint(database, checkpoint) {
  database.prepare(`
    INSERT INTO provider_checkpoint(
      provider, stream, source_fingerprint, last_started_at_ms,
      last_started_count, last_scan_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider, stream) DO UPDATE SET
      source_fingerprint = excluded.source_fingerprint,
      last_started_at_ms = excluded.last_started_at_ms,
      last_started_count = excluded.last_started_count,
      last_scan_at_ms = excluded.last_scan_at_ms
  `).run(
    checkpoint.provider,
    checkpoint.stream,
    checkpoint.sourceFingerprint,
    checkpoint.lastStartedAtMs,
    checkpoint.lastStartedCount,
    checkpoint.lastScanAtMs
  );
}

export function putToolEvent(database, event) {
  const result = database.prepare(`
    INSERT INTO tool_event(
      event_id, provider, source_id, session_hash, turn_hash, call_hash,
      occurred_at_ms, completed_at_ms, tool_name, tool_namespace, route_class,
      is_openadam, derived, status, duration_ms, retry_count, source_format,
      recorded_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      tool_namespace = excluded.tool_namespace,
      route_class = excluded.route_class,
      is_openadam = excluded.is_openadam,
      completed_at_ms = COALESCE(excluded.completed_at_ms, tool_event.completed_at_ms),
      status = CASE
        WHEN excluded.status IN ('completed', 'error', 'cancelled') THEN excluded.status
        ELSE tool_event.status
      END,
      duration_ms = COALESCE(excluded.duration_ms, tool_event.duration_ms),
      retry_count = COALESCE(excluded.retry_count, tool_event.retry_count),
      recorded_at_ms = excluded.recorded_at_ms
    WHERE
      excluded.tool_namespace IS NOT tool_event.tool_namespace
      OR excluded.route_class IS NOT tool_event.route_class
      OR excluded.is_openadam IS NOT tool_event.is_openadam
      OR (excluded.completed_at_ms IS NOT NULL AND excluded.completed_at_ms IS NOT tool_event.completed_at_ms)
      OR (excluded.status IN ('completed', 'error', 'cancelled') AND excluded.status IS NOT tool_event.status)
      OR (excluded.duration_ms IS NOT NULL AND excluded.duration_ms IS NOT tool_event.duration_ms)
      OR (excluded.retry_count IS NOT NULL AND excluded.retry_count IS NOT tool_event.retry_count)
  `).run(
    event.eventId,
    event.provider,
    event.sourceId ?? null,
    event.sessionHash ?? null,
    event.turnHash ?? null,
    event.callHash ?? null,
    event.occurredAtMs ?? null,
    event.completedAtMs ?? null,
    event.toolName,
    event.toolNamespace ?? null,
    event.routeClass,
    event.isOpenAdam ? 1 : 0,
    event.derived ? 1 : 0,
    event.status,
    event.durationMs ?? null,
    event.retryCount ?? null,
    event.sourceFormat,
    event.recordedAtMs
  );
  return result.changes > 0 ? 1 : 0;
}

export function completeToolEvent(database, eventId, status, completedAtMs) {
  const result = database.prepare(`
    UPDATE tool_event SET
      completed_at_ms = ?,
      status = ?,
      duration_ms = CASE
        WHEN occurred_at_ms IS NOT NULL AND ? >= occurred_at_ms THEN ? - occurred_at_ms
        ELSE duration_ms
      END,
      recorded_at_ms = ?
    WHERE event_id = ? AND (completed_at_ms IS NOT ? OR status IS NOT ?)
  `).run(completedAtMs, status, completedAtMs, completedAtMs, Date.now(), eventId, completedAtMs, status);
  return result.changes > 0 ? 1 : 0;
}

export function putUsageEvent(database, event) {
  const result = database.prepare(`
    INSERT INTO usage_event(
      event_id, provider, session_hash, turn_hash, occurred_at_ms, input_tokens,
      cached_input_tokens, output_tokens, reasoning_tokens, total_tokens,
      duration_ms, source_format, recorded_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      occurred_at_ms = COALESCE(excluded.occurred_at_ms, usage_event.occurred_at_ms),
      input_tokens = COALESCE(excluded.input_tokens, usage_event.input_tokens),
      cached_input_tokens = COALESCE(excluded.cached_input_tokens, usage_event.cached_input_tokens),
      output_tokens = COALESCE(excluded.output_tokens, usage_event.output_tokens),
      reasoning_tokens = COALESCE(excluded.reasoning_tokens, usage_event.reasoning_tokens),
      total_tokens = COALESCE(excluded.total_tokens, usage_event.total_tokens),
      duration_ms = COALESCE(excluded.duration_ms, usage_event.duration_ms),
      recorded_at_ms = excluded.recorded_at_ms
    WHERE
      (excluded.occurred_at_ms IS NOT NULL AND excluded.occurred_at_ms IS NOT usage_event.occurred_at_ms)
      OR (excluded.input_tokens IS NOT NULL AND excluded.input_tokens IS NOT usage_event.input_tokens)
      OR (excluded.cached_input_tokens IS NOT NULL AND excluded.cached_input_tokens IS NOT usage_event.cached_input_tokens)
      OR (excluded.output_tokens IS NOT NULL AND excluded.output_tokens IS NOT usage_event.output_tokens)
      OR (excluded.reasoning_tokens IS NOT NULL AND excluded.reasoning_tokens IS NOT usage_event.reasoning_tokens)
      OR (excluded.total_tokens IS NOT NULL AND excluded.total_tokens IS NOT usage_event.total_tokens)
      OR (excluded.duration_ms IS NOT NULL AND excluded.duration_ms IS NOT usage_event.duration_ms)
  `).run(
    event.eventId,
    event.provider,
    event.sessionHash ?? null,
    event.turnHash ?? null,
    event.occurredAtMs ?? null,
    event.inputTokens ?? null,
    event.cachedInputTokens ?? null,
    event.outputTokens ?? null,
    event.reasoningTokens ?? null,
    event.totalTokens ?? null,
    event.durationMs ?? null,
    event.sourceFormat,
    event.recordedAtMs
  );
  return result.changes > 0 ? 1 : 0;
}

export function putProcedureReceipt(database, receipt, recordedAtMs = Date.now()) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const procedure = database.prepare(`
      INSERT INTO procedure_event(
        event_id, invocation_hash, procedure_id, procedure_version,
      implementation_id, implementation_version, outcome, started_at_ms,
        receipt_outcome, completed_at_ms, duration_ms, stage_count, error_code, source_format,
        recorded_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(
      receipt.eventId,
      receipt.invocationHash,
      receipt.procedureId,
      receipt.procedureVersion,
      receipt.implementationId,
      receipt.implementationVersion,
      receipt.outcome === "rejected" ? "error" : receipt.outcome,
      receipt.startedAtMs,
      receipt.outcome,
      receipt.completedAtMs,
      receipt.durationMs,
      receipt.stages.length,
      receipt.errorCode ?? null,
      receipt.sourceFormat,
      recordedAtMs
    );
    let stagesWritten = 0;
    let checkpointsWritten = 0;
    if (procedure.changes > 0) {
      const insertStage = database.prepare(`
        INSERT INTO capability_event(
          event_id, procedure_event_id, stage_index, stage_id, capability_id,
          capability_version, operation_id, provider_id, provider_version,
          transport, target, status, duration_ms, effects, error_code,
          completed_at_ms, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertCheckpoint = database.prepare(`
        INSERT INTO human_checkpoint_event(
          event_id, procedure_event_id, stage_index, stage_id, status,
          authority, decision_source, duration_ms, completed_at_ms, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const stage of receipt.stages) {
        if (stage.kind === "human-checkpoint") {
          insertCheckpoint.run(
            stage.eventId,
            receipt.eventId,
            stage.index,
            stage.stageId,
            stage.status,
            stage.authority,
            stage.decisionSource,
            stage.durationMs,
            receipt.completedAtMs,
            recordedAtMs
          );
          checkpointsWritten += 1;
          continue;
        }
        insertStage.run(
          stage.eventId,
          receipt.eventId,
          stage.index,
          stage.stageId,
          stage.capabilityId,
          stage.capabilityVersion,
          stage.operationId,
          stage.providerId,
          stage.providerVersion,
          stage.transport,
          stage.target,
          stage.status,
          stage.durationMs,
          JSON.stringify(stage.effects),
          stage.errorCode ?? null,
          receipt.completedAtMs,
          recordedAtMs
        );
        stagesWritten += 1;
      }
    }
    database.exec("COMMIT");
    return {
      proceduresWritten: procedure.changes > 0 ? 1 : 0,
      stagesWritten,
      checkpointsWritten
    };
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export function putProviderHealth(database, health) {
  database.prepare(`
    INSERT INTO provider_health(
      provider, status, error_code, files_seen, files_read, bytes_read,
      lines_read, events_written, skipped_lines, backlog_sources, scanned_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      status = excluded.status,
      error_code = excluded.error_code,
      files_seen = excluded.files_seen,
      files_read = excluded.files_read,
      bytes_read = excluded.bytes_read,
      lines_read = excluded.lines_read,
      events_written = excluded.events_written,
      skipped_lines = excluded.skipped_lines,
      backlog_sources = excluded.backlog_sources,
      scanned_at_ms = excluded.scanned_at_ms
  `).run(
    health.provider,
    health.status,
    health.errorCode ?? null,
    health.filesSeen ?? 0,
    health.filesRead ?? 0,
    health.bytesRead ?? 0,
    health.linesRead ?? 0,
    health.eventsWritten ?? 0,
    health.skippedLines ?? 0,
    health.backlogSources ?? 0,
    health.scannedAtMs
  );
}

export function acquireLease(database, durationMs, nowMs = Date.now()) {
  const holder = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database.prepare("SELECT holder, expires_at_ms FROM collector_lease WHERE name = 'collect'").get();
    if (current && current.expires_at_ms > nowMs) {
      database.exec("ROLLBACK");
      return null;
    }
    database.prepare(`
      INSERT INTO collector_lease(name, holder, expires_at_ms) VALUES ('collect', ?, ?)
      ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at_ms = excluded.expires_at_ms
    `).run(holder, nowMs + durationMs);
    database.exec("COMMIT");
    return holder;
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}

export function releaseLease(database, holder) {
  database.prepare("DELETE FROM collector_lease WHERE name = 'collect' AND holder = ?").run(holder);
}

export function startCollectionRun(database, startedAtMs = Date.now()) {
  const runId = randomUUID();
  database.prepare(`
    INSERT INTO collection_run(run_id, started_at_ms, status) VALUES (?, ?, 'running')
  `).run(runId, startedAtMs);
  return runId;
}

export function finishCollectionRun(database, runId, summary) {
  database.prepare(`
    UPDATE collection_run SET
      completed_at_ms = ?, status = ?, providers_ok = ?, providers_partial = ?,
      providers_missing = ?, providers_error = ?, events_written = ?
    WHERE run_id = ?
  `).run(
    summary.completedAtMs,
    summary.status,
    summary.providersOk,
    summary.providersPartial,
    summary.providersMissing,
    summary.providersError,
    summary.eventsWritten,
    runId
  );
}
