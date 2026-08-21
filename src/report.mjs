import { providerHealth, toolReportRows, usageReportRows } from "./db-read.mjs";

function numeric(value) {
  return value === null || value === undefined ? null : Number(value);
}

function signalFor(row) {
  const measured = Number(row.measured);
  const errors = Number(row.errors);
  const calls = Number(row.calls);
  if (measured >= 5 && errors / measured >= 0.2) return "fix-candidate";
  if (calls >= 5) return "observed-use";
  return "insufficient-data";
}

export function buildReport(database, options = {}, nowMs = Date.now()) {
  const days = options.days ?? 30;
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const tools = toolReportRows(database, cutoffMs, options.openAdamOnly === true).map((row) => {
    const measured = Number(row.measured);
    const errors = Number(row.errors);
    return {
      provider: row.provider,
      toolName: row.tool_name,
      toolNamespace: row.tool_namespace,
      routeClass: row.route_class,
      openAdam: row.is_openadam === 1,
      calls: Number(row.calls),
      runtime: {
        measured,
        completed: Number(row.completed),
        errors,
        cancelled: Number(row.cancelled),
        errorRate: measured > 0 ? errors / measured : null,
        averageDurationMs: numeric(row.average_duration_ms),
        retries: numeric(row.retries)
      },
      derivedCalls: Number(row.derived),
      firstObservedAtMs: numeric(row.first_observed_at_ms),
      lastObservedAtMs: numeric(row.last_observed_at_ms),
      signal: signalFor(row),
      correctnessEvidence: "unknown",
      opportunityEvidence: "unknown",
      routingMode: "unknown"
    };
  });
  const usage = usageReportRows(database, cutoffMs).map((row) => ({
    provider: row.provider,
    records: Number(row.records),
    inputTokens: numeric(row.input_tokens),
    cachedInputTokens: numeric(row.cached_input_tokens),
    outputTokens: numeric(row.output_tokens),
    reasoningTokens: numeric(row.reasoning_tokens),
    totalTokens: numeric(row.total_tokens),
    averageDurationMs: numeric(row.average_duration_ms)
  }));
  return {
    generatedAtMs: nowMs,
    windowDays: days,
    filter: options.openAdamOnly ? "openadam" : "all-tools",
    providers: providerHealth(database).map((row) => ({
      provider: row.provider,
      status: row.status,
      errorCode: row.error_code,
      scannedAtMs: Number(row.scanned_at_ms)
    })),
    tools,
    usage,
    portfolio: {
      fixCandidates: tools.filter((tool) => tool.signal === "fix-candidate").map((tool) => ({
        provider: tool.provider,
        toolName: tool.toolName,
        basis: "runtime-error-signal"
      })),
      weakenRoutingCandidates: [],
      retireCandidates: [],
      claimBoundary: "Passive metadata cannot establish correctness, opportunity, natural routing, redundancy, or retirement."
    },
    privacy: {
      rawContentStored: false,
      sourcePathsStored: false,
      networkUsed: false,
      modelCalls: 0
    }
  };
}

function percent(value) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function renderReport(report) {
  const lines = [
    `Agent Tool Observer — ${report.windowDays} day window`,
    `Providers: ${report.providers.map((item) => `${item.provider}=${item.status}`).join(", ") || "none"}`,
    "",
    "Calls  Provider  Tool                                      Runtime errors  Signal",
    "-----  --------  ----------------------------------------  --------------  -----------------"
  ];
  for (const tool of report.tools.slice(0, 50)) {
    const name = tool.toolName.length > 40 ? `${tool.toolName.slice(0, 37)}...` : tool.toolName;
    lines.push(
      `${String(tool.calls).padStart(5)}  ${tool.provider.padEnd(8)}  ${name.padEnd(40)}  ${percent(tool.runtime.errorRate).padStart(14)}  ${tool.signal}`
    );
  }
  if (report.tools.length === 0) lines.push("    0  —         No observations in this window");
  lines.push(
    "",
    `Fix candidates: ${report.portfolio.fixCandidates.length}`,
    "Routing/retirement: insufficient evidence until opportunity and comparable-route data exist.",
    "Privacy: metadata only, no source paths or raw content, no network, no model calls."
  );
  return `${lines.join("\n")}\n`;
}
