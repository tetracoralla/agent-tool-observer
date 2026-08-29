import {
  capabilityReportRows,
  deploymentRoutingEvents,
  deploymentToolRows,
  directRuntimeHealth,
  latestAgentHostDeployment,
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

export const REPORT_SCHEMA_VERSION = "openadam.agent-tool-observer.report.v0.4";
const ROUTING_EVENT_LIMIT = 50_000;
const ROUTING_OBSERVATION_LIMIT = 100;
const SESSION_START_BASIS = Object.freeze({
  codex: "codex-session-meta-timestamp",
  claude: "earliest-observed-claude-session-record-timestamp",
  zcode: "zcode-session-time-created-when-source-schema-exposes-it"
});

export function isCurrentReport(value) {
  return value?.schemaVersion === REPORT_SCHEMA_VERSION
    && Array.isArray(value.tools)
    && value.freshSessionCorrelation?.adoptionStatus === "not-assessed"
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

function operationKey(value) {
  const text = String(value);
  if (text.startsWith("mcp__")) return semanticKey(text.split("__").at(-1));
  return semanticKey(text);
}

function toolMatchesBinding(toolName, target) {
  return semanticKey(toolName) === semanticKey(target)
    || operationKey(toolName) === operationKey(target);
}

function hasSemanticTarget(toolName, targets) {
  return targets.some((target) => toolMatchesBinding(toolName, target));
}

function deploymentFromRow(row) {
  if (!row) return null;
  return {
    deploymentId: row.deployment_id,
    observedAtMs: Number(row.observed_at_ms),
    activatedAtMs: Number(row.activated_at_ms),
    channel: row.channel,
    releaseId: row.release_id,
    suiteVersion: row.suite_version,
    profile: row.profile,
    components: JSON.parse(row.components_json),
    context: row.context_source_id === null ? null : {
      sourceId: row.context_source_id,
      sourceRevision: row.context_source_revision,
      catalogSha256: row.context_catalog_sha256,
      catalogBytes: numeric(row.context_catalog_bytes),
      toolCount: numeric(row.context_tool_count)
    },
    observationBasis: "agent-host-deployment-observation"
  };
}

function deploymentBinding(toolName, deployment) {
  if (!deployment) return null;
  for (const component of deployment.components) {
    const matchedToolName = component.toolNames.find((candidate) => toolMatchesBinding(toolName, candidate));
    if (matchedToolName) return { component, matchedToolName };
  }
  return null;
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

function deploymentRoutingAnalysis(rows, deployment) {
  if (!deployment) {
    return {
      observations: [],
      summary: {
        observationRecordsReturned: 0,
        observationRecordLimit: ROUTING_OBSERVATION_LIMIT,
        observationRecordsTruncated: false,
        matchingTurnsInScannedEvents: 0,
        sourceEventsScanned: 0,
        sourceEventLimit: ROUTING_EVENT_LIMIT,
        sourceEventsTruncated: false
      }
    };
  }
  const sourceEventsTruncated = rows.length > ROUTING_EVENT_LIMIT;
  const boundedRows = rows.slice(0, ROUTING_EVENT_LIMIT);
  const turns = new Map();
  for (const row of boundedRows) {
    const key = `${row.provider}\0${row.session_hash}\0${row.turn_hash}`;
    if (!turns.has(key)) {
      turns.set(key, {
        provider: row.provider,
        sessionHash: row.session_hash,
        turnHash: row.turn_hash,
        events: []
      });
    }
    turns.get(key).events.push(row);
  }
  const matchingTurns = [...turns.values()].flatMap((turn) => {
    const firstReleaseIndex = turn.events.findIndex((event) => deploymentBinding(event.tool_name, deployment));
    if (firstReleaseIndex < 0) return [];
    const preceding = turn.events.slice(0, firstReleaseIndex);
    const releaseEvents = turn.events.filter((event) => deploymentBinding(event.tool_name, deployment));
    const recoveryObserved = releaseEvents.some((event, index) => event.status === "error"
      && releaseEvents.slice(index + 1).some((later) => later.tool_name === event.tool_name && later.status === "completed"));
    const counts = new Map();
    for (const event of releaseEvents) counts.set(event.tool_name, (counts.get(event.tool_name) ?? 0) + 1);
    return [{
      provider: turn.provider,
      sessionHash: turn.sessionHash,
      turnHash: turn.turnHash,
      firstObservedTool: turn.events[0].tool_name,
      firstCurrentReleaseTool: turn.events[firstReleaseIndex].tool_name,
      currentReleaseToolFirst: firstReleaseIndex === 0,
      precedingToolCalls: preceding.length,
      precedingShellOrOrchestrationCalls: preceding.filter((event) => ["native-shell", "orchestration"].includes(event.route_class)).length,
      currentReleaseCalls: releaseEvents.length,
      currentReleaseErrors: releaseEvents.filter((event) => event.status === "error").length,
      runtimeRetries: releaseEvents.reduce((sum, event) => sum + Number(event.retry_count ?? 0), 0),
      repeatedCurrentReleaseCalls: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      recoveryObserved,
      taskQualityStatus: "unknown",
      opportunityStatus: "unknown",
      observationBasis: "fresh-session-tool-order-metadata"
    }];
  });
  return {
    observations: matchingTurns.slice(0, ROUTING_OBSERVATION_LIMIT),
    summary: {
      observationRecordsReturned: Math.min(matchingTurns.length, ROUTING_OBSERVATION_LIMIT),
      observationRecordLimit: ROUTING_OBSERVATION_LIMIT,
      observationRecordsTruncated: sourceEventsTruncated || matchingTurns.length > ROUTING_OBSERVATION_LIMIT,
      matchingTurnsInScannedEvents: matchingTurns.length,
      sourceEventsScanned: boundedRows.length,
      sourceEventLimit: ROUTING_EVENT_LIMIT,
      sourceEventsTruncated
    }
  };
}

function sessionCoverageStatus(calls, unknownSessionStartCalls) {
  if (calls === 0) return "no-current-release-tool-calls-observed";
  if (unknownSessionStartCalls === 0) return "complete-for-observed-calls";
  if (unknownSessionStartCalls === calls) return "unavailable-for-observed-calls";
  return "partial-for-observed-calls";
}

function freshSessionCorrelation(deploymentRows, deployment, routingSummary) {
  const providers = new Map(Object.entries(SESSION_START_BASIS).map(([provider, sessionStartBasis]) => [provider, {
    provider,
    sessionStartBasis,
    currentReleaseToolCallsSinceActivation: 0,
    callsWithKnownSessionStart: 0,
    callsWithUnknownSessionStart: 0,
    freshSessionCallsSinceActivation: 0,
    preActivationSessionCallsSinceActivation: 0
  }]));
  if (deployment) {
    for (const row of deploymentRows) {
      if (!deploymentBinding(row.tool_name, deployment)) continue;
      const provider = providers.get(row.provider);
      if (!provider) continue;
      const calls = Number(row.calls ?? 0);
      const fresh = Number(row.fresh_session_calls ?? 0);
      const preActivation = Number(row.pre_activation_session_calls ?? 0);
      const unknown = Number(row.unknown_session_start_calls ?? 0);
      provider.currentReleaseToolCallsSinceActivation += calls;
      provider.callsWithKnownSessionStart += fresh + preActivation;
      provider.callsWithUnknownSessionStart += unknown;
      provider.freshSessionCallsSinceActivation += fresh;
      provider.preActivationSessionCallsSinceActivation += preActivation;
    }
  }
  return {
    scope: deployment ? "declared-current-agent-host-tool-bindings-since-release-activation" : "no-current-agent-host-deployment",
    providers: [...providers.values()].map((provider) => ({
      ...provider,
      coverageStatus: sessionCoverageStatus(provider.currentReleaseToolCallsSinceActivation, provider.callsWithUnknownSessionStart)
    })),
    routing: routingSummary,
    adoptionStatus: "not-assessed",
    taskQualityStatus: "unknown",
    opportunityStatus: "unknown",
    observationBasis: "provider-native-or-provider-record-session-start-metadata"
  };
}

export function buildReport(database, options = {}, nowMs = Date.now()) {
  const days = options.days ?? 30;
  const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
  const currentDeployment = deploymentFromRow(latestAgentHostDeployment(database));
  const deploymentRows = currentDeployment ? deploymentToolRows(database, currentDeployment.activatedAtMs) : [];
  const deploymentCalls = new Map(
    deploymentRows
      .map((row) => [`${row.provider}\0${row.tool_name}`, row])
  );
  const usageAssociations = new Map(
    toolUsageAssociationRows(database, cutoffMs, options.openAdamOnly === true)
      .map((row) => [`${row.provider}\0${row.tool_name}`, row])
  );
  const tools = toolReportRows(database, cutoffMs, options.openAdamOnly === true).map((row) => {
    const measured = Number(row.measured);
    const errors = Number(row.errors);
    const associated = usageAssociations.get(`${row.provider}\0${row.tool_name}`);
    const binding = deploymentBinding(row.tool_name, currentDeployment);
    const deploymentCall = deploymentCalls.get(`${row.provider}\0${row.tool_name}`);
    const freshSessionCalls = Number(deploymentCall?.fresh_session_calls ?? 0);
    const preActivationSessionCalls = Number(deploymentCall?.pre_activation_session_calls ?? 0);
    const unknownSessionStartCalls = Number(deploymentCall?.unknown_session_start_calls ?? 0);
    const callsSinceActivation = Number(deploymentCall?.calls ?? 0);
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
      routingMode: "unknown",
      currentAgentHostDeployment: binding ? {
        status: freshSessionCalls > 0
          ? "fresh-session-observed"
          : callsSinceActivation === 0
            ? "declared-binding-only"
            : unknownSessionStartCalls === callsSinceActivation
              ? "session-start-unavailable"
              : "no-fresh-session-correlation",
        releaseId: currentDeployment.releaseId,
        suiteVersion: currentDeployment.suiteVersion,
        profile: currentDeployment.profile,
        componentId: binding.component.id,
        componentVersion: binding.component.version,
        declaredToolName: binding.matchedToolName,
        callsSinceActivation,
        freshSessionCallsSinceActivation: freshSessionCalls,
        preActivationSessionCallsSinceActivation: preActivationSessionCalls,
        unknownSessionStartCallsSinceActivation: unknownSessionStartCalls,
        ambiguousSessionCallsSinceActivation: preActivationSessionCalls + unknownSessionStartCalls,
        sessionStartBasis: SESSION_START_BASIS[row.provider] ?? "unavailable",
        sessionStartCoverageStatus: sessionCoverageStatus(callsSinceActivation, unknownSessionStartCalls),
        mappingBasis: "declared-agent-host-tool-binding-and-provider-session-start-metadata"
      } : {
        status: row.is_openadam === 1 ? "outside-current-agent-host-deployment" : "not-applicable"
      }
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
    } : row.target_kind === "mcp-operation" ? {
      kind: "mcp-operation",
      toolName: row.tool_name,
      operationId: row.operation_id
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
    currentInstalledBindingStatus: !currentDeployment?.context
      ? "not_assessed"
      : currentDeployment.context.sourceId === row.source_id
        && currentDeployment.context.sourceRevision === row.source_revision
        && currentDeployment.context.catalogSha256 === row.catalog_sha256
        ? "matched-current-agent-host-deployment"
        : "not-current-agent-host-deployment"
  }));
  const routingAnalysis = currentDeployment
    ? deploymentRoutingAnalysis(deploymentRoutingEvents(database, currentDeployment.activatedAtMs), currentDeployment)
    : deploymentRoutingAnalysis([], null);
  const routingObservations = routingAnalysis.observations;
  const deploymentFreshSessionCorrelation = freshSessionCorrelation(deploymentRows, currentDeployment, routingAnalysis.summary);
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
    currentAgentHostDeployment: currentDeployment,
    freshSessionCorrelation: deploymentFreshSessionCorrelation,
    routingObservations,
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
        installedCatalogAcquisition: currentDeployment?.context
          ? "agent-host-deployment-observation"
          : "outside-observer"
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
      claimBoundary: "Legacy receipts record declared execution and binding identity; Direct Runtime events record metadata about actual direct execution; imported Context Surface analyses measure explicit snapshots. Agent Host deployment observations declare one active immutable release. A matching tool name from a provider record whose observed session start is at or after activation is only a current-release correlation candidate, not causal attribution or proof of the catalog loaded by that host; pre-activation and unknown-start sessions remain separate. Fresh-session routing records are bounded metadata records, and their returned count is not a total when either bound is reached. None establishes correctness, adoption opportunity, natural routing, redundancy, retirement, exclusive call attribution, task quality, or authorization."
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
    `Current Agent Host deployment: ${report.currentAgentHostDeployment?.releaseId ?? "not observed"}`,
    `Discovery candidates: ${(report.portfolio.capabilityCandidates ?? []).length} Capability contracts, ${(report.portfolio.procedureCandidates ?? []).length} Procedure evaluations`,
    "Routing/retirement: insufficient data until opportunity and comparable-route observations exist.",
    "Privacy: metadata only, no source paths or raw content, no network, no model calls."
  );
  return `${lines.join("\n")}\n`;
}
