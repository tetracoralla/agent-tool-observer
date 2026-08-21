# Current status

Verified on 2026-08-21 on the owner Mac.

## Development regression: PASS

- `npm run check`: PASS;
- 31 Node tests cover all three provider adapters, idempotency, active-lease
  exclusion, partial lines, malformed/deep/oversized records, truncation,
  symlink rejection, privacy projection, conservative report claims,
  code-text false-positive exclusion, schema migration and taxonomy repair,
  provider-schema drift, bounded ZCode pagination and timestamp ties,
  fail-closed Codex context recovery, session-scoped call correlation,
  LaunchAgent rendering, and owner-only log targets;
- production-source contract check confirms no networking modules, dynamic
  evaluation, or third-party runtime dependencies;
- fixture CLI smoke completes collection, status, report, and privacy checks.

## Installed automatic runtime: PASS

- LaunchAgent label: `com.openadam.agent-tool-observer`;
- schedule: run at login and every 300 seconds;
- execution: one short-lived `collect` process, no `KeepAlive`;
- current loaded program resolves through the stable Homebrew Node 22 path;
- idempotent reinstall: PASS;
- RunAtLoad collection completed with exit code 0;
- scheduled successful collection is quiet: the existing stdout log remained
  exactly 49,033 bytes while both snapshots advanced;
- owner-only SQLite, status snapshot, report snapshot, and log files were
  created under the declared Application Support directory;
- status/report snapshots are readable without opening the live WAL database.

## Provider coverage

- Claude Code: PASS, current 30-day JSONL source is caught up;
- ZCode: PASS, current `tool_usage` and `model_usage` tables read successfully
  under bounded pagination;
  a settled source now produces zero repeated event writes while terminal-state
  transitions remain refreshable;
- Codex: PARTIAL, the installed RunAtLoad scan safely consumed its 64 MiB share
  and left 146 source backlogs for later five-minute runs; no source error was
  reported and the cursor will continue automatically;

## Privacy and side effects: PASS

- zero network calls and zero model calls;
- no prompts, messages, reasoning, source paths, project paths, commands, tool
  arguments/results, or provider error text in the observer schema;
- provider source bytes remained unchanged in integration tests;
- the observer and LaunchAgent write allowlist contains only their state,
  snapshot, log, and plist targets; no tool-repository write path exists;
- installer and snapshot failures report committed side effects explicitly.

The before/after repository fingerprint check remained identical for every
pre-existing tool repository except `universal-inspector`, whose already-dirty
working tree changed concurrently during this review. The observer has no
source mutation primitive or configured path into that repository, so this is
recorded as an external concurrency exception rather than observer output.

## Claim boundary

The current report supports observed-use and runtime-error signals. It does not
produce weaken-routing or retirement candidates until comparable opportunity,
routing-mode, and controlled evaluation evidence exists.

## Business/experience acceptance

Pending owner use over ordinary work. No publication or external-user rollout
has been authorized.
