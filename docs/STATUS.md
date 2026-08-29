# Current status

Verified on 2026-08-28 on the owner Mac.

## Development regression: PASS

- `npm run check`: PASS;
- 54 Node tests cover all three Agent-shell adapters, Direct Runtime metadata,
  Context Surface import, idempotency, active-lease
  exclusion, partial lines, malformed/deep/oversized records, truncation,
  symlink rejection, privacy projection, conservative report claims,
  code-text false-positive exclusion, schema migration and taxonomy repair,
  provider-schema drift, bounded ZCode pagination and timestamp ties,
  fail-closed Codex context recovery, cross-provider session-start correlation,
  bounded routing truncation, semantic deployment refresh deduplication,
  LaunchAgent rendering, content-addressed runtime installation, owner-only log
  targets, payload-size projection, shared-turn token association, and the
  wrapper/derived Procedure-candidate negative case;
- production-source contract check confirms no networking modules, dynamic
  evaluation, or third-party runtime dependencies;
- fixture CLI smoke completes collection, status, report, and privacy checks.

## Installed automatic runtime: PASS

- LaunchAgent label: `com.openadam.agent-tool-observer`;
- schedule: run at login and every 300 seconds;
- execution: one short-lived `collect` process, no `KeepAlive`;
- current loaded program resolves through the stable Homebrew Node 22 path and
  the fixed content-addressed Observer runtime
  `0.1.0-692bd44a5d346185fa6ab7cfb65eafc3a37b2c1b827324bf81fbe8f7aee89021`;
- idempotent reinstall: PASS;
- the LaunchAgent no longer references the mutable development checkout;
- RunAtLoad and a subsequent fixed-runtime collection completed with exit code
  0; the loaded service is short-lived and currently not running between its
  five-minute intervals;
- owner-only SQLite, status snapshot, report snapshot, and log files were
  created under the declared Application Support directory;
- status/report snapshots are readable without opening the live WAL database.

## Provider coverage

- Claude Code: PASS, current 30-day JSONL source is caught up;
- ZCode: PASS, current `tool_usage` and `model_usage` tables read successfully
  under bounded pagination;
  a settled source now produces zero repeated event writes while terminal-state
  transitions remain refreshable;
- Codex: PASS, current source is caught up with no backlog or skipped lines;
- fresh-session basis is explicit per provider: Codex session metadata, the
  earliest observed Claude session record, and ZCode `session.time_created`
  when that source table exists. Unknown starts remain separate rather than
  becoming zero or fresh;
- Direct Runtime metadata: PASS, one owner-only exact JSONL source is caught up;
  715 actual local-pilot calls are stored as semantic execution metadata across
  Math Anchor, Migratory Time, Dependency Preflight, and Structured Data
  Preflight targets;
- Context Surface import: PASS, one explicit current local plugin-subset
  measurement records 42 tools, 70 schemas, 256,417 canonical catalog bytes,
  and zero claimed token measurements. It does not claim complete Codex catalog
  coverage or current installed binding.

## Privacy and side effects: PASS

- zero network calls and zero model calls;
- no prompts, messages, reasoning, source paths, project paths, commands, tool
  arguments/results, or provider error text in the observer schema;
- provider source bytes remained unchanged in integration tests;
- the observer and LaunchAgent write allowlist contains only their state,
  snapshot, log, and plist targets; no tool-repository write path exists;
- installer and snapshot failures report committed side effects explicitly.

The v0.4 report marks dynamic payload-byte coverage and shared-turn token
association as partial, rather than treating missing rows as zero. Existing
history predates payload-byte collection; current Codex coverage begins with
newly observed `exec` envelopes. Direct Runtime events provide per-semantic-call
request/result sizes and zero-model timing. Monetary cost remains unavailable
because compatible model and pricing identity are not observed per tool call.

## Claim boundary

The current report supports observed-use and runtime-error signals. Its
fresh-session and bounded-routing fields are deterministic correlations, not
an adoption, opportunity, causation, correctness, or task-quality assessment.
Those judgments remain outside Observer and require current task context in an
external Agent or reviewer.

## Business/experience acceptance

Pending owner use over ordinary work. No publication or external-user rollout
has been authorized.
