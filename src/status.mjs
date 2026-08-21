import { databaseStats, latestCollection, providerHealth } from "./db-read.mjs";

export function buildStatus(database, config) {
  return {
    state: databaseStats(database),
    latestCollection: latestCollection(database),
    providers: providerHealth(database).map((row) => ({
      provider: row.provider,
      status: row.status,
      errorCode: row.error_code,
      filesSeen: Number(row.files_seen),
      filesRead: Number(row.files_read),
      bytesRead: Number(row.bytes_read),
      linesRead: Number(row.lines_read),
      eventsWritten: Number(row.events_written),
      skippedLines: Number(row.skipped_lines),
      backlogSources: Number(row.backlog_sources),
      scannedAtMs: Number(row.scanned_at_ms)
    })),
    automaticIntervalSeconds: 300,
    databasePath: config.databasePath,
    privacy: { rawContentStored: false, sourcePathsStored: false, networkUsed: false, modelCalls: 0 }
  };
}

export function renderStatus(status) {
  const lines = [
    `Tool events: ${status.state.toolEvents}; usage events: ${status.state.usageEvents}; sources: ${status.state.sources}`,
    `Latest collection: ${status.latestCollection?.status ?? "never"}`
  ];
  for (const provider of status.providers) {
    lines.push(`${provider.provider}: ${provider.status}${provider.errorCode ? ` (${provider.errorCode})` : ""}`);
  }
  lines.push("Privacy: metadata only; no source paths/raw content; no network/model calls.");
  return `${lines.join("\n")}\n`;
}
