#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "./collector.mjs";
import { resolveConfig } from "./config.mjs";
import { openReadOnlyStateDatabase, openStateDatabase } from "./db.mjs";
import { ObserverError } from "./errors.mjs";
import { installLaunchAgent, uninstallLaunchAgent } from "./installer.mjs";
import { buildReport, renderReport } from "./report.mjs";
import { ingestProcedureReceipts } from "./semantic-receipts.mjs";
import { readSnapshot, writeSnapshot } from "./snapshot.mjs";
import { buildStatus, renderStatus } from "./status.mjs";

process.umask(0o077);

function usage() {
  return `Usage:
  agent-tool-observer collect [--json|--quiet]
  agent-tool-observer status [--json]
  agent-tool-observer report [--days N] [--openadam] [--json]
  agent-tool-observer ingest-receipts --file FILE [--json]
  agent-tool-observer install [--dry-run] [--json]
  agent-tool-observer uninstall [--json]
`;
}

function parseArguments(argumentsList) {
  const command = argumentsList[0];
  if (!command || ["help", "--help", "-h"].includes(command)) return { command: "help" };
  const options = {
    command,
    json: false,
    quiet: false,
    dryRun: false,
    openAdamOnly: false,
    days: 30,
    file: null
  };
  for (let index = 1; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--openadam") options.openAdamOnly = true;
    else if (argument === "--days") {
      const value = Number(argumentsList[++index]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 3650) {
        throw new ObserverError("ARGUMENT_INVALID", "--days must be an integer from 1 to 3650");
      }
      options.days = value;
    } else if (argument === "--file") {
      const value = argumentsList[++index];
      if (!value) throw new ObserverError("ARGUMENT_INVALID", "--file requires a path");
      options.file = path.resolve(value);
    } else {
      throw new ObserverError("ARGUMENT_UNKNOWN", `Unknown argument: ${argument}`);
    }
  }
  if (options.json && options.quiet) {
    throw new ObserverError("ARGUMENT_INVALID", "--json and --quiet cannot be used together");
  }
  if (options.quiet && options.command !== "collect") {
    throw new ObserverError("ARGUMENT_INVALID", "--quiet is supported only by collect");
  }
  if (options.command === "ingest-receipts" && options.file === null) {
    throw new ObserverError("ARGUMENT_INVALID", "ingest-receipts requires --file");
  }
  if (options.file !== null && options.command !== "ingest-receipts") {
    throw new ObserverError("ARGUMENT_INVALID", "--file is supported only by ingest-receipts");
  }
  return options;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function renderCollect(result) {
  if (result.status === "skipped") return `Collection skipped: ${result.reason}\n`;
  const providers = result.providers.map((item) => `${item.provider}=${item.status}`).join(", ");
  return `Collection ${result.status}: ${providers}; ${result.eventsWritten} projected writes; no network or model calls.\n`;
}

function filterOpenAdamSnapshot(report) {
  const tools = report.tools.filter((tool) => tool.openAdam === true);
  return {
    ...report,
    filter: "openadam",
    tools,
    portfolio: {
      ...report.portfolio,
      fixCandidates: report.portfolio.fixCandidates.filter((candidate) => tools.some(
        (tool) => tool.provider === candidate.provider && tool.toolName === candidate.toolName
      ))
    }
  };
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList);
  if (options.command === "help") {
    process.stdout.write(usage());
    return 0;
  }
  const config = resolveConfig();
  if (options.command === "install") {
    const result = installLaunchAgent(config, { dryRun: options.dryRun });
    options.json ? printJson(result) : process.stdout.write(`LaunchAgent ${result.status}: ${result.label}\n`);
    return 0;
  }
  if (options.command === "uninstall") {
    const result = uninstallLaunchAgent(config);
    options.json ? printJson(result) : process.stdout.write("LaunchAgent uninstalled; local observations preserved.\n");
    return 0;
  }

  if (options.command === "collect") {
    const database = openStateDatabase(config);
    try {
      const result = collect(database, config);
      try {
        writeSnapshot(config, "latest-report.json", buildReport(database, { days: 30 }));
        writeSnapshot(config, "latest-status.json", buildStatus(database, config));
        result.snapshots = { status: "completed" };
      } catch (error) {
        result.status = result.status === "error" ? "error" : "partial";
        result.snapshots = {
          status: "error",
          errorCode: error instanceof ObserverError ? error.code : "SNAPSHOT_WRITE_FAILED",
          collectionCommitted: true
        };
      }
      if (options.json) printJson(result);
      else if (!options.quiet) process.stdout.write(renderCollect(result));
      return 0;
    } finally {
      database.close();
    }
  }
  if (options.command === "ingest-receipts") {
    const database = openStateDatabase(config);
    try {
      const result = ingestProcedureReceipts(database, options.file);
      try {
        writeSnapshot(config, "latest-report.json", buildReport(database, { days: 30 }));
        result.snapshots = { status: "completed" };
      } catch (error) {
        result.status = "partial";
        result.snapshots = {
          status: "error",
          errorCode: error instanceof ObserverError ? error.code : "SNAPSHOT_WRITE_FAILED",
          ingestionCommitted: true
        };
      }
      if (options.json) printJson(result);
      else process.stdout.write(
        `Receipt ingestion ${result.status}: ${result.proceduresWritten} Procedures and ${result.capabilityStagesWritten} Capability stages written; raw content not stored.\n`
      );
      return 0;
    } finally {
      database.close();
    }
  }
  if (options.command === "status") {
    let result;
    try {
      result = readSnapshot(config, "latest-status.json");
    } catch {
      const database = openReadOnlyStateDatabase(config);
      try {
        result = buildStatus(database, config);
      } finally {
        database.close();
      }
    }
    options.json ? printJson(result) : process.stdout.write(renderStatus(result));
    return 0;
  }
  if (options.command === "report") {
    let result;
    if (options.days === 30) {
      try {
        result = readSnapshot(config, "latest-report.json");
        if (options.openAdamOnly) result = filterOpenAdamSnapshot(result);
      } catch {
        result = null;
      }
    }
    if (result === null || result === undefined) {
      const database = openReadOnlyStateDatabase(config);
      try {
        result = buildReport(database, options);
      } finally {
        database.close();
      }
    }
    options.json ? printJson(result) : process.stdout.write(renderReport(result));
    return 0;
  }
  throw new ObserverError("COMMAND_UNKNOWN", `Unknown command: ${options.command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    const code = error instanceof ObserverError ? error.code : "OBSERVER_FAILED";
    process.stderr.write(`${JSON.stringify({ status: "error", error: { code, message: error.message } })}\n`);
    process.exitCode = 1;
  });
}
