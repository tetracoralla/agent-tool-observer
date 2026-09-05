# Agent Tool Observer

> **Current source:** [agent-tool-observer in Agent Host](https://github.com/tetracoralla/agent-host-suite/tree/main/packages/agent-tool-observer).
> Development, installation, and current integration documentation now belong to
> Agent Host. This repository retains the earlier standalone source; the
> instructions below describe that historical version.

Agent Tool Observer is a private, local-only observer for the Agent clients on
this Mac. It incrementally reads the structured records already written by
Codex, Claude Code, and ZCode, projects only bounded usage metadata into its own
SQLite database, and produces conservative tool-portfolio reports.

It does not instrument tools, modify client records, capture screens or
keystrokes, upload data, call a model, or run baseline/treatment evaluations.

Direct Execution Runtime may write an optional metadata-only
`openadam.direct-execution-observation.v0.1` JSONL log. The observer reads that
exact owner-local file incrementally and records versioned Capability,
Procedure, or MCP target identity together with terminal state, latency, queue
time, serialized request/result byte counts, and cold/warm session state. Work
orders, call IDs, inputs, results, and error messages are not retained.

Context Surface Analyzer remains responsible for measuring an explicit tool
catalog snapshot. Its successful `context-surface.analysis.v0.1` result can be
imported into the observer; the observer stores only source revision, digests,
counts, byte measurements, and explicitly reported token measurements. It does
not discover or crawl installed catalogs.

Agent Host may also hand the observer one bounded
`openadam.agent-host-deployment-observation.v0.1` file. It contains the active
compatibility-release identity, immutable component versions and digests,
declared Agent-visible tool bindings, and the exact imported catalog digest.
That lets reports correlate passive calls with the release that declared the
binding without storing task content, commands, or filesystem paths.

## Commands

```sh
node --no-warnings src/cli.mjs collect
node --no-warnings src/cli.mjs status
node --no-warnings src/cli.mjs report --days 30
node --no-warnings src/cli.mjs report --days 30 --openadam --json
node --no-warnings src/cli.mjs ingest-context-surface --file /path/to/analysis.json --json
node --no-warnings src/cli.mjs ingest-agent-host-deployment --file /path/to/deployment.json --json
node --no-warnings src/cli.mjs maintain --dry-run --json
node --no-warnings src/cli.mjs maintain --json
node --no-warnings src/cli.mjs install --dry-run
node --no-warnings src/cli.mjs install
```

`--dry-run` is accepted only by `maintain` and `install`; command-specific or
duplicate options fail before any action instead of being silently ignored.

Disabling or uninstalling the LaunchAgent preserves the database. To remove
that shared local history as a separate destructive action:

```sh
node --no-warnings src/cli.mjs purge --confirm-local-data-removal
```

The default local state lives under:

```text
~/Library/Application Support/OpenAdam/Agent Tool Observer/
```

The installer registers `com.openadam.agent-tool-observer` as a macOS
LaunchAgent. It runs one short-lived incremental collection every five minutes
and at login. Uninstalling the LaunchAgent preserves the local observation
database. Each run also refreshes owner-only `latest-status.json` and
`latest-report.json` snapshots so sandboxed local Agents can inspect the result
without opening the live SQLite database. Successful background runs are
silent; provider state remains visible in those snapshots and explicit CLI
commands still print normally.

Installation copies the current Observer runtime into an owner-only,
content-addressed directory under its state folder. The LaunchAgent points to
that fixed copy, so later edits to a development checkout cannot silently
change scheduled collection. Reinstalling selects a new digest while retaining
older copies for inspection or rollback.

An embedding release may set `ATO_NODE_EXECUTABLE` to its own verified Node
binary. The installer then binds the LaunchAgent to that exact executable and
fails closed instead of falling back to another machine installation.

The current report schema is
`openadam.agent-tool-observer.report.v0.5`. Older report snapshots are rebuilt
from the current database before they are returned. v0.5 reports semantic
execution only from the current Direct Runtime metadata boundary; retired
pre-release Procedure receipts are not accepted or projected.

The default reporting window is 30 days and the default retained event window
is 45 days. `maintain` removes only rows older than that bound, preserves the
latest Context Surface measurement per source and the current Agent Host
deployment observation, checkpoints the write-ahead log, and compacts SQLite.
`ATO_RETENTION_DAYS` may raise the bound but cannot be lower than
`ATO_LOOKBACK_DAYS`.

Explicit provider roots, the ZCode database, and Direct Runtime log overrides
must be absolute paths. `ATO_DISABLE_PROVIDERS` accepts only `codex`, `claude`,
`zcode`, and `direct-runtime`; misspellings fail closed.

## Supported sources

- Codex session JSONL under `~/.codex/sessions` and
  `~/.codex/archived_sessions`;
- Claude Code project JSONL under `~/.claude/projects`;
- ZCode usage tables in `~/.zcode/cli/db/db.sqlite`.
- the exact Direct Runtime metadata log named by `ATO_DIRECT_RUNTIME_LOGS`
  (or the standalone default path) when that runtime is launched with the
  matching `--observation-log` option;
- explicit Context Surface analysis files supplied to
  `ingest-context-surface`.
- explicit Agent Host deployment observations supplied to
  `ingest-agent-host-deployment`.

Direct Runtime targets retain the distinction between a whole MCP tool and one
explicitly projected MCP operation, so reports do not erase the selected
operation identity.

Missing or changed providers are reported independently; one provider cannot
silently make the others look healthy.

## Claim boundary

The report can show observed calls, transport/runtime completion, errors,
cancellation, retries, latency, and token usage where the client exposes them.
For Claude and ZCode, token counts may be associated with a tool-bearing turn,
but a multi-tool turn shares the same counts and the report does not attribute
them to one tool. Codex currently exposes a cumulative session rollup, so it is
not assigned to individual tools. Serialized payload byte counts are
measurements only; their content is never stored. Monetary cost remains
explicitly unavailable until model and pricing identity are observed at a
compatible granularity.
Direct Runtime metadata may add versioned Procedure, Capability, or projected
MCP execution identity, but correctness remains unknown. Repeated unmapped MCP
use and repeated
same-turn tool sequences may nominate a Capability-contract or Procedure
evaluation.
It cannot prove task correctness, that an unused tool had an opportunity, that
the Agent selected a tool naturally, that a nominated sequence is
professionally correct, or that a tool should be retired. Those
remain `insufficient-data` until a targeted controlled evaluation supplies the
missing observations and comparison assessment.

An Agent Host deployment observation can establish that a passive tool name
matches one declared binding in one named compatibility release. Codex, Claude,
and ZCode session-start coverage and its provider-specific basis are reported
separately. Calls from a hashed session whose recorded start is at or after
release activation are counted separately from calls made by pre-activation or
unknown-start sessions. For fresh sessions the report also preserves bounded
tool-order metadata: whether the release tool was first, preceding
shell/orchestration call counts, retries, errors, and observed same-tool
recovery. Both scan and returned-record truncation are explicit, so the number
of returned routing records is never presented as total turns. It does not
store commands or task content and does not establish that the Agent had an
opportunity, selected the best tool, or produced a good result.

## Development

```sh
npm test
npm run check
```

There are no third-party runtime dependencies.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
