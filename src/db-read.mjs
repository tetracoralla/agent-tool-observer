export function latestCollection(database) {
  return database.prepare(`
    SELECT * FROM collection_run ORDER BY started_at_ms DESC LIMIT 1
  `).get() ?? null;
}

export function providerHealth(database) {
  return database.prepare(`
    SELECT * FROM provider_health ORDER BY provider
  `).all();
}

export function databaseStats(database) {
  return {
    toolEvents: Number(database.prepare("SELECT count(*) AS value FROM tool_event").get().value),
    usageEvents: Number(database.prepare("SELECT count(*) AS value FROM usage_event").get().value),
    procedureEvents: Number(database.prepare("SELECT count(*) AS value FROM procedure_event").get().value),
    capabilityEvents: Number(database.prepare("SELECT count(*) AS value FROM capability_event").get().value),
    humanCheckpointEvents: Number(
      database.prepare("SELECT count(*) AS value FROM human_checkpoint_event").get().value
    ),
    sources: Number(database.prepare("SELECT count(*) AS value FROM source_cursor").get().value)
  };
}

export function toolReportRows(database, cutoffMs, openAdamOnly = false) {
  return database.prepare(`
    SELECT
      provider,
      tool_name,
      tool_namespace,
      route_class,
      is_openadam,
      count(*) AS calls,
      sum(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      sum(CASE WHEN status IN ('completed', 'error', 'cancelled') THEN 1 ELSE 0 END) AS measured,
      sum(CASE WHEN derived = 1 THEN 1 ELSE 0 END) AS derived,
      avg(duration_ms) AS average_duration_ms,
      sum(retry_count) AS retries,
      min(occurred_at_ms) AS first_observed_at_ms,
      max(occurred_at_ms) AS last_observed_at_ms
    FROM tool_event
    WHERE occurred_at_ms >= ? AND (? = 0 OR is_openadam = 1)
    GROUP BY provider, tool_name, tool_namespace, route_class, is_openadam
    ORDER BY calls DESC, tool_name ASC
  `).all(cutoffMs, openAdamOnly ? 1 : 0);
}

export function usageReportRows(database, cutoffMs) {
  return database.prepare(`
    SELECT
      provider,
      count(*) AS records,
      sum(input_tokens) AS input_tokens,
      sum(cached_input_tokens) AS cached_input_tokens,
      sum(output_tokens) AS output_tokens,
      sum(reasoning_tokens) AS reasoning_tokens,
      sum(total_tokens) AS total_tokens,
      avg(duration_ms) AS average_duration_ms
    FROM usage_event
    WHERE occurred_at_ms >= ?
    GROUP BY provider
    ORDER BY provider
  `).all(cutoffMs);
}

export function procedureReportRows(database, cutoffMs) {
  return database.prepare(`
    SELECT
      procedure_id,
      procedure_version,
      implementation_id,
      implementation_version,
      count(*) AS runs,
      sum(CASE WHEN receipt_outcome = 'success' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN receipt_outcome = 'error' THEN 1 ELSE 0 END) AS errors,
      sum(CASE WHEN receipt_outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked,
      sum(CASE WHEN receipt_outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      avg(duration_ms) AS average_duration_ms,
      min(completed_at_ms) AS first_observed_at_ms,
      max(completed_at_ms) AS last_observed_at_ms
    FROM procedure_event
    WHERE completed_at_ms >= ?
    GROUP BY procedure_id, procedure_version, implementation_id, implementation_version
    ORDER BY runs DESC, procedure_id ASC
  `).all(cutoffMs);
}

export function capabilityReportRows(database, cutoffMs) {
  return database.prepare(`
    SELECT
      capability_id,
      capability_version,
      operation_id,
      provider_id,
      provider_version,
      transport,
      target,
      count(*) AS executions,
      sum(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      sum(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      avg(CASE WHEN status != 'skipped' THEN duration_ms END) AS average_duration_ms,
      min(completed_at_ms) AS first_observed_at_ms,
      max(completed_at_ms) AS last_observed_at_ms
    FROM capability_event
    WHERE completed_at_ms >= ?
    GROUP BY capability_id, capability_version, operation_id, provider_id,
      provider_version, transport, target
    ORDER BY executions DESC, capability_id ASC, operation_id ASC
  `).all(cutoffMs);
}

export function humanCheckpointReportRows(database, cutoffMs) {
  return database.prepare(`
    SELECT
      procedure_event.procedure_id,
      procedure_event.procedure_version,
      procedure_event.implementation_id,
      procedure_event.implementation_version,
      human_checkpoint_event.stage_id,
      human_checkpoint_event.authority,
      count(*) AS observations,
      sum(CASE WHEN human_checkpoint_event.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      sum(CASE WHEN human_checkpoint_event.status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      sum(CASE WHEN human_checkpoint_event.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      sum(CASE WHEN human_checkpoint_event.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
      avg(CASE WHEN human_checkpoint_event.status != 'skipped'
        THEN human_checkpoint_event.duration_ms END) AS average_duration_ms,
      min(human_checkpoint_event.completed_at_ms) AS first_observed_at_ms,
      max(human_checkpoint_event.completed_at_ms) AS last_observed_at_ms
    FROM human_checkpoint_event
    JOIN procedure_event
      ON procedure_event.event_id = human_checkpoint_event.procedure_event_id
    WHERE human_checkpoint_event.completed_at_ms >= ?
    GROUP BY procedure_event.procedure_id, procedure_event.procedure_version,
      procedure_event.implementation_id, procedure_event.implementation_version,
      human_checkpoint_event.stage_id, human_checkpoint_event.authority
    ORDER BY observations DESC, procedure_event.procedure_id ASC,
      human_checkpoint_event.stage_id ASC
  `).all(cutoffMs);
}

export function toolSequenceEvents(database, cutoffMs, openAdamOnly = false) {
  return database.prepare(`
    SELECT provider, session_hash, turn_hash, tool_name, occurred_at_ms, event_id
    FROM tool_event
    WHERE occurred_at_ms >= ?
      AND session_hash IS NOT NULL
      AND turn_hash IS NOT NULL
      AND (? = 0 OR is_openadam = 1)
    ORDER BY provider, session_hash, turn_hash, occurred_at_ms, event_id
    LIMIT 50000
  `).all(cutoffMs, openAdamOnly ? 1 : 0);
}

export function semanticTargets(database) {
  return database.prepare(`
    SELECT DISTINCT target FROM capability_event ORDER BY target
  `).all().map((row) => row.target);
}

export function schemaColumns(database) {
  const tables = [
    "source_cursor", "provider_checkpoint", "tool_event", "usage_event",
    "procedure_event", "capability_event", "human_checkpoint_event",
    "provider_health", "collection_run",
    "collector_lease"
  ];
  return tables.flatMap((table) => database.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    table,
    name: row.name
  })));
}
