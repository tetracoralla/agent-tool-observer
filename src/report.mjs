import {
  capabilityReportRows,
  humanCheckpointReportRows,
  procedureReportRows,
  providerHealth,
  semanticTargets,
  toolReportRows,
  toolSequenceEvents,
  usageReportRows
} from "./db-read.mjs";

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

function semanticKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toolMatchesBinding(toolName, target) {
  return semanticKey(toolName).endsWith(semanticKey(target));
}

function hasSemanticTarget(toolName, targets) {
  return targets.some((target) => toolMatchesBinding(toolName, target));
}

function sequenceCandidates(rows) {
  const turns = new Map();
  for (const row of rows) {
    const key = `${row.provider}\0${row.session_hash}\0${row.turn_hash}`;
    if (!turns.has(key)) {
      turns.set(key, { provider: row.provider, session: row.session_hash, tools: [] });
    }
    const tools = turns.get(key).tools;
    if (tools.at(-1) !== row.tool_name) tools.push(row.tool_name);
  }
  const sequences = new Map();
  for (const turn of turns.values()) {
    if (turn.tools.length < 2 || turn.tools.length > 8) continue;
    const key = `${turn.provider}\0${turn.tools.join("\0")}`;
    if (!sequences.has(key)) {
      sequences.set(key, { provider: turn.provider, tools: turn.tools, turns: 0, sessions: new Set() });
    }
    const candidate = sequences.get(key);
    candidate.turns += 1;
    candidate.sessions.add(turn.session);
  }
  return [...sequences.values()]
    .filter((candidate) => candidate.turns >= 3 && candidate.sessions.size >= 2)
    .map((candidate) => ({
      provider: candidate.provider,
      sequence: candidate.tools,
      observedTurns: candidate.turns,
      observedSessions: candidate.sessions.size,
      signal: "candidate-for-procedure-evaluation",
      correctnessEvidence: "unknown"
    }))
    .sort((left, right) => right.observedTurns - left.observedTurns
      || left.sequence.join("\0").localeCompare(right.sequence.join("\0")))
    .slice(0, 25);
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
  const procedures = procedureReportRows(database, cutoffMs).map((row) => ({
    procedureId: row.procedure_id,
    procedureVersion: row.procedure_version,
    implementationId: row.implementation_id,
    implementationVersion: row.implementation_version,
    runs: Number(row.runs),
    runtime: {
      completed: Number(row.completed),
      errors: Number(row.errors),
      blocked: Number(row.blocked),
      rejected: Number(row.rejected),
      averageDurationMs: numeric(row.average_duration_ms)
    },
    firstObservedAtMs: numeric(row.first_observed_at_ms),
    lastObservedAtMs: numeric(row.last_observed_at_ms),
    correctnessEvidence: "unknown"
  }));
  const capabilities = capabilityReportRows(database, cutoffMs).map((row) => {
    const passiveObservedCalls = row.transport === "mcp-tool"
      ? tools.filter((tool) => tool.routeClass === "mcp"
        && toolMatchesBinding(tool.toolName, row.target))
        .reduce((total, tool) => total + tool.calls, 0)
      : 0;
    return {
      capabilityId: row.capability_id,
      capabilityVersion: row.capability_version,
      operationId: row.operation_id,
      providerId: row.provider_id,
      providerVersion: row.provider_version,
      binding: { transport: row.transport, target: row.target },
      executions: Number(row.executions),
      passiveObservedCalls,
      passiveMappingBasis: row.transport === "mcp-tool"
        ? "declared-receipt-binding-target"
        : "unavailable-for-transport",
      runtime: {
        completed: Number(row.completed),
        errors: Number(row.errors),
        skipped: Number(row.skipped),
        averageDurationMs: numeric(row.average_duration_ms)
      },
      firstObservedAtMs: numeric(row.first_observed_at_ms),
      lastObservedAtMs: numeric(row.last_observed_at_ms),
      correctnessEvidence: "unknown"
    };
  });
  const humanCheckpoints = humanCheckpointReportRows(database, cutoffMs).map((row) => ({
    procedureId: row.procedure_id,
    procedureVersion: row.procedure_version,
    implementationId: row.implementation_id,
    implementationVersion: row.implementation_version,
    stageId: row.stage_id,
    authority: row.authority,
    observations: Number(row.observations),
    decisions: {
      pending: Number(row.pending),
      accepted: Number(row.accepted),
      rejected: Number(row.rejected),
      skipped: Number(row.skipped)
    },
    averageDurationMs: numeric(row.average_duration_ms),
    firstObservedAtMs: numeric(row.first_observed_at_ms),
    lastObservedAtMs: numeric(row.last_observed_at_ms),
    authorityEvidence: "declared-human-source",
    identityAuthentication: "host-required",
    correctnessEvidence: "unknown"
  }));
  const targets = semanticTargets(database);
  const capabilityCandidates = tools
    .filter((tool) => tool.routeClass === "mcp" && tool.calls >= 5
      && !hasSemanticTarget(tool.toolName, targets))
    .map((tool) => ({
      provider: tool.provider,
      toolName: tool.toolName,
      calls: tool.calls,
      signal: "candidate-for-capability-contract",
      basis: "repeated-unmapped-mcp-use",
      correctnessEvidence: "unknown"
    }));
  const procedureCandidates = sequenceCandidates(
    toolSequenceEvents(database, cutoffMs, options.openAdamOnly === true)
  );
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
    procedures,
    capabilities,
    humanCheckpoints,
    portfolio: {
      fixCandidates: tools.filter((tool) => tool.signal === "fix-candidate").map((tool) => ({
        provider: tool.provider,
        toolName: tool.toolName,
        basis: "runtime-error-signal"
      })),
      capabilityCandidates,
      procedureCandidates,
      weakenRoutingCandidates: [],
      retireCandidates: [],
      claimBoundary: "Receipts establish declared execution and binding identity, while passive repetition only nominates contract or Procedure evaluations; neither establishes correctness, opportunity, natural routing, redundancy, or retirement."
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
    `Semantic receipts: ${(report.procedures ?? []).length} Procedure implementations, ${(report.capabilities ?? []).length} Capability bindings, ${(report.humanCheckpoints ?? []).length} human checkpoints`,
    `Discovery candidates: ${(report.portfolio.capabilityCandidates ?? []).length} Capability contracts, ${(report.portfolio.procedureCandidates ?? []).length} Procedure evaluations`,
    "Routing/retirement: insufficient evidence until opportunity and comparable-route data exist.",
    "Privacy: metadata only, no source paths or raw content, no network, no model calls."
  );
  return `${lines.join("\n")}\n`;
}
