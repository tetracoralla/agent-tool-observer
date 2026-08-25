import {
  acquireLease,
  finishCollectionRun,
  putDirectRuntimeHealth,
  putProviderHealth,
  releaseLease,
  startCollectionRun
} from "./db.mjs";
import { stableErrorCode } from "./errors.mjs";
import { scanClaude } from "./providers/claude.mjs";
import { scanCodex } from "./providers/codex.mjs";
import { scanZcode } from "./providers/zcode.mjs";
import { scanDirectRuntime } from "./providers/direct-runtime.mjs";

const PROVIDERS = ["codex", "claude", "zcode"];

function disabledHealth(provider, scannedAtMs) {
  return {
    provider,
    status: "disabled",
    errorCode: null,
    filesSeen: 0,
    filesRead: 0,
    bytesRead: 0,
    linesRead: 0,
    eventsWritten: 0,
    skippedLines: 0,
    backlogSources: 0,
    scannedAtMs
  };
}

function failedHealth(provider, scannedAtMs, error) {
  return {
    provider,
    status: "error",
    errorCode: stableErrorCode(error),
    filesSeen: 0,
    filesRead: 0,
    bytesRead: 0,
    linesRead: 0,
    eventsWritten: 0,
    skippedLines: 0,
    backlogSources: 0,
    scannedAtMs
  };
}

function summarizeHealth(health) {
  const count = (status) => health.filter((item) => item.status === status).length;
  const providersOk = count("ok");
  const providersPartial = count("partial");
  const providersMissing = count("missing");
  const providersError = count("error");
  const enabled = health.filter((item) => item.status !== "disabled");
  const status = providersError > 0 && providersOk + providersPartial === 0
    ? "error"
    : providersPartial > 0 || providersMissing > 0 || providersError > 0
      ? "partial"
      : enabled.length === 0 ? "skipped" : "completed";
  return {
    status,
    providersOk,
    providersPartial,
    providersMissing,
    providersError,
    eventsWritten: health.reduce((sum, item) => sum + item.eventsWritten, 0)
  };
}

export function collect(database, config, nowMs = Date.now()) {
  const wallStartedAtMs = Date.now();
  const lease = acquireLease(database, config.limits.leaseMs, nowMs);
  if (lease === null) {
    return {
      status: "skipped",
      reason: "collection-already-running",
      startedAtMs: nowMs,
      completedAtMs: Date.now(),
      providers: []
    };
  }
  const runId = startCollectionRun(database, nowMs);
  const minimumMtimeMs = nowMs - config.limits.lookbackDays * 24 * 60 * 60 * 1000;
  const deadlineMs = wallStartedAtMs + config.limits.maxWallTimeMs;
  const jsonBudget = () => ({
    remainingBytes: Math.floor(config.limits.maxBytesPerRun / 2),
    remainingLines: Math.floor(config.limits.maxLinesPerRun / 2),
    deadlineMs
  });
  const budgets = { codex: jsonBudget(), claude: jsonBudget() };
  const health = [];
  const scanners = {
    codex: () => scanCodex({ database, config, minimumMtimeMs, scannedAtMs: nowMs, budget: budgets.codex }),
    claude: () => scanClaude({ database, config, minimumMtimeMs, scannedAtMs: nowMs, budget: budgets.claude }),
    zcode: () => {
      if (Date.now() >= deadlineMs) {
        return { ...disabledHealth("zcode", nowMs), status: "partial", errorCode: "RUN_DEADLINE_REACHED", backlogSources: 1 };
      }
      return scanZcode({ database, config, minimumMtimeMs, scannedAtMs: nowMs, deadlineMs });
    }
  };
  try {
    for (const provider of PROVIDERS) {
      let providerHealth;
      if (config.disabledProviders.has(provider)) {
        providerHealth = disabledHealth(provider, nowMs);
      } else {
        try {
          providerHealth = scanners[provider]();
        } catch (error) {
          providerHealth = failedHealth(provider, nowMs, error);
        }
      }
      putProviderHealth(database, providerHealth);
      health.push(providerHealth);
    }
    let directRuntimeHealth;
    if (config.disabledProviders.has("direct-runtime")) {
      directRuntimeHealth = {
        ...disabledHealth("direct-runtime", nowMs),
        source: "direct-runtime"
      };
    } else {
      try {
        directRuntimeHealth = scanDirectRuntime({ database, config, scannedAtMs: nowMs, deadlineMs });
      } catch (error) {
        directRuntimeHealth = {
          ...failedHealth("direct-runtime", nowMs, error),
          source: "direct-runtime"
        };
      }
    }
    putDirectRuntimeHealth(database, directRuntimeHealth);
    const summary = summarizeHealth(health);
    summary.eventsWritten += directRuntimeHealth.eventsWritten;
    const completedAtMs = Date.now();
    finishCollectionRun(database, runId, { ...summary, completedAtMs });
    return {
      runId,
      ...summary,
      startedAtMs: nowMs,
      completedAtMs,
      providers: health,
      semanticSources: [directRuntimeHealth],
      rawContentStored: false,
      networkUsed: false,
      modelCalls: 0
    };
  } catch (error) {
    const completedAtMs = Date.now();
    finishCollectionRun(database, runId, {
      completedAtMs,
      status: "error",
      providersOk: 0,
      providersPartial: 0,
      providersMissing: 0,
      providersError: 1,
      eventsWritten: 0
    });
    throw error;
  } finally {
    releaseLease(database, lease);
  }
}
