# Agent Tool Observer

Agent Tool Observer is a private, local-only observer for the Agent clients on
this Mac. It incrementally reads the structured records already written by
Codex, Claude Code, and ZCode, projects only bounded usage metadata into its own
SQLite database, and produces conservative tool-portfolio reports.

It does not instrument tools, modify client records, capture screens or
keystrokes, upload data, call a model, or run baseline/treatment evaluations.

## Commands

```sh
node --no-warnings src/cli.mjs collect
node --no-warnings src/cli.mjs status
node --no-warnings src/cli.mjs report --days 30
node --no-warnings src/cli.mjs report --days 30 --openadam --json
node --no-warnings src/cli.mjs install --dry-run
node --no-warnings src/cli.mjs install
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

## Supported sources

- Codex session JSONL under `~/.codex/sessions` and
  `~/.codex/archived_sessions`;
- Claude Code project JSONL under `~/.claude/projects`;
- ZCode usage tables in `~/.zcode/cli/db/db.sqlite`.

Missing or changed providers are reported independently; one provider cannot
silently make the others look healthy.

## Claim boundary

The report can show observed calls, transport/runtime completion, errors,
cancellation, retries, latency, and token usage where the client exposes them.
It cannot prove task correctness, that an unused tool had an opportunity, that
the Agent selected a tool naturally, or that a tool should be retired. Those
remain `insufficient-data` until a targeted controlled evaluation supplies the
missing evidence.

## Development

```sh
npm test
npm run check
```

There are no third-party runtime dependencies.
