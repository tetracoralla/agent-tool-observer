# Agent Tool Observer

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

Procedure implementations may also hand an explicit metadata-only
`openadam.procedure-receipt.v0.1` or `v0.2` JSON, JSONL, or array file to the
observer. These receipt formats are **legacy**: the portable receipt and
human-checkpoint semantics were removed from the Procedure standard on
2026-08-23, and this ingestion path exists only to read records that were
already produced under the old formats. The observer validates the file,
hashes invocation identity, and stores only semantic execution metadata—not
asset content or provider results. v0.2 human-checkpoint stages are structurally
checked and then discarded; no checkpoint, approval, or reviewer state is
persisted or reported.

## Commands

```sh
node --no-warnings src/cli.mjs collect
node --no-warnings src/cli.mjs status
node --no-warnings src/cli.mjs report --days 30
node --no-warnings src/cli.mjs report --days 30 --openadam --json
node --no-warnings src/cli.mjs ingest-receipts --file /path/to/receipts.json --json
node --no-warnings src/cli.mjs ingest-context-surface --file /path/to/analysis.json --json
node --no-warnings src/cli.mjs install --dry-run
node --no-warnings src/cli.mjs install
```

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
`openadam.agent-tool-observer.report.v0.3`. Older report snapshots are rebuilt
from the current database before they are returned.

## Supported sources

- Codex session JSONL under `~/.codex/sessions` and
  `~/.codex/archived_sessions`;
- Claude Code project JSONL under `~/.claude/projects`;
- ZCode usage tables in `~/.zcode/cli/db/db.sqlite`.
- the exact Direct Runtime metadata log named by `ATO_DIRECT_RUNTIME_LOGS`
  (or the standalone default path) when that runtime is launched with the
  matching `--observation-log` option;
- explicit Procedure Receipt files supplied to `ingest-receipts`.
- explicit Context Surface analysis files supplied to
  `ingest-context-surface`.

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
Ingested legacy receipts add declared Procedure/Capability execution and
binding identity; their human-checkpoint fields are discarded on read. A
declared MCP binding may map passive call counts to that Capability, but
correctness remains unknown. A legacy checkpoint's `source: human` was never
identity authentication and never proved the decision was professionally
correct. Repeated unmapped MCP use and repeated
same-turn tool sequences may nominate a Capability-contract or Procedure
evaluation.
It cannot prove task correctness, that an unused tool had an opportunity, that
the Agent selected a tool naturally, that a nominated sequence is
professionally correct, or that a tool should be retired. Those
remain `insufficient-data` until a targeted controlled evaluation supplies the
missing observations and comparison assessment.

## Development

```sh
npm test
npm run check
```

There are no third-party runtime dependencies.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
