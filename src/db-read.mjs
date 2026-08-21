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

export function schemaColumns(database) {
  const tables = ["source_cursor", "provider_checkpoint", "tool_event", "usage_event", "provider_health", "collection_run", "collector_lease"];
  return tables.flatMap((table) => database.prepare(`PRAGMA table_info(${table})`).all().map((row) => ({
    table,
    name: row.name
  })));
}
