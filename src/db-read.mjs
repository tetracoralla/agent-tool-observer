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

export function directRuntimeHealth(database) {
  return database.prepare(`
    SELECT * FROM direct_runtime_health WHERE source = 'direct-runtime'
  `).get() ?? null;
}

export function databaseStats(database) {
  return {
    toolEvents: Number(database.prepare("SELECT count(*) AS value FROM tool_event").get().value),
    usageEvents: Number(database.prepare("SELECT count(*) AS value FROM usage_event").get().value),
    procedureEvents: Number(database.prepare("SELECT count(*) AS value FROM procedure_event").get().value),
    capabilityEvents: Number(database.prepare("SELECT count(*) AS value FROM capability_event").get().value),
    semanticExecutionEvents: Number(database.prepare("SELECT count(*) AS value FROM semantic_execution_event").get().value),
    contextSurfaceMeasurements: Number(database.prepare("SELECT count(*) AS value FROM context_surface_measurement").get().value),
    directRuntimeSources: Number(database.prepare("SELECT count(*) AS value FROM direct_runtime_cursor").get().value),
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
      sum(request_bytes) AS request_bytes,
      sum(response_bytes) AS response_bytes,
      sum(CASE WHEN request_bytes IS NOT NULL THEN 1 ELSE 0 END) AS request_bytes_measured,
      sum(CASE WHEN response_bytes IS NOT NULL THEN 1 ELSE 0 END) AS response_bytes_measured,
      min(occurred_at_ms) AS first_observed_at_ms,
      max(occurred_at_ms) AS last_observed_at_ms
    FROM tool_event
    WHERE occurred_at_ms >= ? AND (? = 0 OR is_openadam = 1)
    GROUP BY provider, tool_name, tool_namespace, route_class, is_openadam
    ORDER BY calls DESC, tool_name ASC
  `).all(cutoffMs, openAdamOnly ? 1 : 0);
}

export function toolUsageAssociationRows(database, cutoffMs, openAdamOnly = false) {
  return database.prepare(`
    WITH tool_turns AS (
      SELECT DISTINCT provider, tool_name, turn_hash
      FROM tool_event
      WHERE occurred_at_ms >= ?
        AND provider IN ('claude', 'zcode')
        AND turn_hash IS NOT NULL
        AND (? = 0 OR is_openadam = 1)
    )
    SELECT
      tool_turns.provider,
      tool_turns.tool_name,
      count(DISTINCT tool_turns.turn_hash) AS associated_turns,
      count(usage_event.event_id) AS usage_records,
      sum(usage_event.input_tokens) AS input_tokens,
      sum(usage_event.cached_input_tokens) AS cached_input_tokens,
      sum(usage_event.output_tokens) AS output_tokens,
      sum(usage_event.reasoning_tokens) AS reasoning_tokens,
      sum(usage_event.total_tokens) AS total_tokens
    FROM tool_turns
    JOIN usage_event
      ON usage_event.provider = tool_turns.provider
      AND usage_event.turn_hash = tool_turns.turn_hash
      AND usage_event.occurred_at_ms >= ?
    GROUP BY tool_turns.provider, tool_turns.tool_name
    ORDER BY tool_turns.provider, tool_turns.tool_name
  `).all(cutoffMs, openAdamOnly ? 1 : 0, cutoffMs);
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

export function semanticExecutionReportRows(database, cutoffMs) {
  return database.prepare(`
    SELECT
      target_kind, semantic_id, semantic_version, operation_id, tool_name,
      provider_id, provider_version, transport, lifecycle,
      count(*) AS executions,
      sum(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS completed,
      sum(CASE WHEN status = 'provider_error' THEN 1 ELSE 0 END) AS provider_errors,
      sum(CASE WHEN status = 'host_error' THEN 1 ELSE 0 END) AS host_errors,
      avg(duration_ms) AS average_duration_ms,
      avg(queue_ms) AS average_queue_ms,
      avg(provider_round_trip_ms) AS average_provider_round_trip_ms,
      sum(request_bytes) AS request_bytes,
      sum(response_bytes) AS response_bytes,
      min(completed_at_ms) AS first_observed_at_ms,
      max(completed_at_ms) AS last_observed_at_ms
    FROM semantic_execution_event
    WHERE completed_at_ms >= ?
    GROUP BY target_kind, semantic_id, semantic_version, operation_id, tool_name,
      provider_id, provider_version, transport, lifecycle
    ORDER BY executions DESC, provider_id, semantic_id, operation_id, tool_name
  `).all(cutoffMs);
}

export function latestContextSurfaceRows(database) {
  return database.prepare(`
    SELECT * FROM (
      SELECT *, row_number() OVER (
        PARTITION BY source_id ORDER BY imported_at_ms DESC, measurement_id DESC
      ) AS rank
      FROM context_surface_measurement
    ) WHERE rank = 1
    ORDER BY source_id
  `).all();
}

export function toolSequenceEvents(database, cutoffMs, openAdamOnly = false) {
  return database.prepare(`
    SELECT provider, session_hash, turn_hash, tool_name, occurred_at_ms, event_id
    FROM tool_event
    WHERE occurred_at_ms >= ?
      AND session_hash IS NOT NULL
      AND turn_hash IS NOT NULL
      AND derived = 0
      AND route_class = 'mcp'
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
    "procedure_event", "capability_event",
    "direct_runtime_cursor", "direct_runtime_health", "semantic_execution_event",
    "context_surface_measurement",
    "provider_health", "collection_run",
    "collector_lease"
  ];
  return tables.flatMap((table) => database.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    table,
    name: row.name
  })));
}
