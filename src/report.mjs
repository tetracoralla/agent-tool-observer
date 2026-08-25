import {
  capabilityReportRows,
  directRuntimeHealth,
  latestContextSurfaceRows,
  procedureReportRows,
  providerHealth,
  semanticTargets,
  semanticExecutionReportRows,
  toolReportRows,
  toolSequenceEvents,
  toolUsageAssociationRows,
  usageReportRows
} from "./db-read.mjs";

export const REPORT_SCHEMA_VERSION = "openadam.agent-tool-observer.report.v0.3";

export function isCurrentReport(value) {
  return value?.schemaVersion === REPORT_SCHEMA_VERSION
    && Array.isArray(value.tools)
    && value.cost?.monetary?.status === "unavailable"
    && value.tools.every((tool) => tool?.correctnessStatus === "unknown"
      && tool?.opportunityStatus === "unknown"
      && !(("correctness" + "Evidence") in tool)
      && !(("opportunity" + "Evidence") in tool));
}

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
      correctnessStatus: "unknown"
    }))
    .sort((left, right) => right.observedTurns - left.observedTurns
      || left.sequence.join("\0").localeCompare(right.sequence.join("\0")))
    .slice(0, 25);
}

export function buildReport(database, options = {}, nowMs = Date.now()) {
  const days = options.days ?? 30;
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const usageAssociations = new Map(
    toolUsageAssociationRows(database, cutoffMs, options.openAdamOnly === true)
      .map((row) => [`${row.provider}\0${row.tool_name}`, row])
  );
  const tools = toolReportRows(database, cutoffMs, options.openAdamOnly === true).map((row) => {
    const measured = Number(row.measured);
    const errors = Number(row.errors);
    const associated = usageAssociations.get(`${row.provider}\0${row.tool_name}`);
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
      payload: {
        requestBytes: numeric(row.request_bytes),
        responseBytes: numeric(row.response_bytes),
        requestBytesMeasuredCalls: Number(row.request_bytes_measured),
        responseBytesMeasuredCalls: Number(row.response_bytes_measured),
        measurementBasis: "serialized-tool-payload-size-without-content-retention"
      },
      turnAssociatedUsage: associated ? {
        associatedTurns: Number(associated.associated_turns),
        usageRecords: Number(associated.usage_records),
        inputTokens: numeric(associated.input_tokens),
        cachedInputTokens: numeric(associated.cached_input_tokens),
        outputTokens: numeric(associated.output_tokens),
        reasoningTokens: numeric(associated.reasoning_tokens),
        totalTokens: numeric(associated.total_tokens),
        allocation: "shared-turn-not-attributed-to-one-tool"
      } : {
        associatedTurns: 0,
        usageRecords: 0,
        inputTokens: null,
        cachedInputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        totalTokens: null,
        allocation: row.provider === "codex"
          ? "unavailable-session-cumulative-provider-usage"
          : "no-matching-turn-usage"
      },
      firstObservedAtMs: numeric(row.first_observed_at_ms),
      lastObservedAtMs: numeric(row.last_observed_at_ms),
      signal: signalFor(row),
      correctnessStatus: "unknown",
      opportunityStatus: "unknown",
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
    averageDurationMs: numeric(row.average_duration_ms),
    semantics: row.provider === "codex"
      ? "latest-cumulative-session-rollup-per-observed-session"
      : row.provider === "claude"
        ? "message-usage-total-excludes-separately-reported-cache-read"
        : "provider-reported-model-usage-record"
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
    correctnessStatus: "unknown"
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
      correctnessStatus: "unknown"
    };
  });
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
      correctnessStatus: "unknown"
    }));
  const procedureCandidates = sequenceCandidates(
    toolSequenceEvents(database, cutoffMs, options.openAdamOnly === true)
  );
  const semanticExecutions = semanticExecutionReportRows(database, cutoffMs).map((row) => ({
    target: row.target_kind === "capability" ? {
      kind: "capability",
      capabilityId: row.semantic_id,
      capabilityVersion: row.semantic_version,
      operationId: row.operation_id
    } : row.target_kind === "procedure" ? {
      kind: "procedure",
      procedureId: row.semantic_id,
      procedureVersion: row.semantic_version
    } : {
      kind: "mcp-tool",
      toolName: row.tool_name
    },
    providerId: row.provider_id,
    providerVersion: row.provider_version,
    transport: row.transport,
    lifecycle: row.lifecycle,
    executions: Number(row.executions),
    runtime: {
      completed: Number(row.completed),
      providerErrors: Number(row.provider_errors),
      hostErrors: Number(row.host_errors),
      averageDurationMs: numeric(row.average_duration_ms),
      averageQueueMs: numeric(row.average_queue_ms),
      averageProviderRoundTripMs: numeric(row.average_provider_round_trip_ms)
    },
    payload: {
      requestBytes: numeric(row.request_bytes),
      responseBytes: numeric(row.response_bytes)
    },
    executionCost: {
      modelCalls: 0,
      tokenUsage: null,
      monetaryCost: null,
      externalCostStatus: "not_observed"
    },
    firstObservedAtMs: numeric(row.first_observed_at_ms),
    lastObservedAtMs: numeric(row.last_observed_at_ms),
    observationBasis: "direct-runtime-metadata-event",
    correctnessStatus: "unknown"
  }));
  const directHealth = directRuntimeHealth(database);
  const contextSurfaces = latestContextSurfaceRows(database).map((row) => ({
    source: { id: row.source_id, revision: row.source_revision },
    importedAtMs: Number(row.imported_at_ms),
    snapshot: { sha256: row.snapshot_sha256, canonicalUtf8Bytes: Number(row.snapshot_bytes) },
    catalog: {
      sha256: row.catalog_sha256,
      canonicalUtf8Bytes: Number(row.catalog_bytes),
      largestToolUtf8Bytes: Number(row.largest_tool_bytes)
    },
    counts: {
      tools: Number(row.tool_count),
      schemas: Number(row.schema_count),
      describedTools: Number(row.described_tool_count),
      duplicateSchemas: Number(row.duplicate_schema_count),
      hardNameCollisions: Number(row.hard_name_collision_count)
    },
    tokenMeasurements: JSON.parse(row.token_measurements_json),
    measurementBasis: "explicit-context-surface-analysis-import",
    currentInstalledBindingStatus: "not_assessed"
  }));
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
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
    cost: {
      dynamicPayloadBytes: {
        status: tools.some((tool) => tool.payload.requestBytesMeasuredCalls > 0
          || tool.payload.responseBytesMeasuredCalls > 0) ? "partial" : "unavailable",
        contentStored: false
      },
      tokenAssociation: {
        status: tools.some((tool) => tool.turnAssociatedUsage.usageRecords > 0) ? "partial" : "unavailable",
        allocation: "shared-turn-not-attributed-to-one-tool"
      },
      staticContext: {
        status: contextSurfaces.length > 0 ? "explicit-snapshots-imported" : "unavailable",
        installedCatalogAcquisition: "outside-observer"
      },
      monetary: {
        status: "unavailable",
        reason: "model-and-pricing-identity-not-observed-at-tool-call-granularity"
      }
    },
    procedures,
    capabilities,
    semanticExecutions,
    directRuntime: directHealth ? {
      status: directHealth.status,
      errorCode: directHealth.error_code,
      scannedAtMs: Number(directHealth.scanned_at_ms),
      filesSeen: Number(directHealth.files_seen),
      eventsWritten: Number(directHealth.events_written)
    } : {
      status: "not-collected",
      errorCode: null,
      scannedAtMs: null,
      filesSeen: 0,
      eventsWritten: 0
    },
    contextSurfaces,
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
      claimBoundary: "Legacy receipts record declared execution and binding identity; Direct Runtime events record metadata about actual direct execution; imported Context Surface analyses measure explicit snapshots; passive repetition only nominates evaluations. None establishes correctness, opportunity, natural routing, redundancy, retirement, current installed binding, cost attribution, or authorization."
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
    `Legacy semantic receipts: ${(report.procedures ?? []).length} Procedure implementations, ${(report.capabilities ?? []).length} Capability bindings (human-checkpoint fields discarded on read)`,
    `Direct semantic execution groups: ${(report.semanticExecutions ?? []).length}; source=${report.directRuntime?.status ?? "not-collected"}`,
    `Static context snapshots: ${(report.contextSurfaces ?? []).length}; monetary cost=${report.cost?.monetary?.status ?? "unavailable"}`,
    `Discovery candidates: ${(report.portfolio.capabilityCandidates ?? []).length} Capability contracts, ${(report.portfolio.procedureCandidates ?? []).length} Procedure evaluations`,
    "Routing/retirement: insufficient data until opportunity and comparable-route observations exist.",
    "Privacy: metadata only, no source paths or raw content, no network, no model calls."
  );
  return `${lines.join("\n")}\n`;
}
