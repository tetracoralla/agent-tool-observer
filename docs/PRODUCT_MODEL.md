# Product model

## User and task

The user is the owner of this Mac and the maintainer of a portfolio of
Agent-native tools. Their recurring task is to learn, without manually
watching ordinary Agent work, which tools are actually observed, unreliable,
slow, costly, or plausible candidates for a focused comparison with a native
client or shell route.

The product is backstage local infrastructure. It has no external-user
telemetry role and no hosted service.

## Product boundary

```text
Codex persisted events  --- read-only adapter --\
Claude persisted events --- read-only adapter ---- local projection -> report
ZCode usage database    --- read-only adapter --/
Direct Runtime JSONL    --- exact-file adapter --/
Procedure receipt file  --- explicit validator -- local projection -> report
Context analysis result --- explicit validator -/
                                                    |
                                                    +-> targeted candidate only
                                                        agent-tool-evals
```

The observer owns passive collection, local persistence, provider health, and
descriptive portfolio signals. `agent-tool-evals` owns controlled conditional
comparison. Observed tools and their repositories own product behavior.

The observer never:

- changes a tool, plugin, Skill, Agent instruction, or provider database;
- uploads data or invokes a model;
- stores prompts, messages, reasoning, paths, commands, arguments, results, or
  error text;
- treats zero observed calls as zero opportunity;
- treats completion as correctness;
- automatically weakens routing or retires a tool.

Semantic input has three distinct paths. Legacy Procedure-receipt import validates
and projects a bounded file supplied by the owner or an in-scope implementation.
Direct Runtime collection reads only its exact optional metadata log and accepts
only the closed `openadam.direct-execution-observation.v0.1` event shape. Static
Context Surface measurement is an explicit import of an Analyzer result. None
of these paths scans arbitrary output directories or discovers installed tool
catalogs.

## Automatic flow

The macOS LaunchAgent starts a short-lived `collect` command at login and every
five minutes. Each run:

1. acquires a bounded lease in the observer database;
2. discovers regular JSONL files beneath exact provider roots without
   following symlinks;
3. reads only bytes after each hashed source cursor, retaining an incomplete
   final line for the next run; an incremental Codex source fails closed if its
   bounded prefix cannot recover the session identity needed for correlation;
4. opens the ZCode database read-only and projects new or newly completed
   usage rows in bounded pages from privacy-safe incremental checkpoints;
5. hashes source identifiers and writes only normalized metadata;
6. incrementally reads the exact optional Direct Runtime metadata log;
7. writes bounded metadata-only status and 30-day report snapshots;
8. records independent provider/source health and exits.

No process listens for connections or remains resident between scans.

## Deterministic core

One core owns:

- source discovery and bounded incremental JSONL reading;
- identifier hashing and privacy projection;
- provider-specific event normalization;
- deduplicated SQLite persistence;
- tool namespace and route classification;
- conservative report aggregation and signal assignment;
- installation preflight and LaunchAgent rendering.

The CLI and LaunchAgent call the same collection entry point.

## Stored data

Tool observations retain:

- hashed event, source, session, turn, and call identifiers;
- provider and normalized tool name;
- route class and whether the observation was statically derived from an
  orchestration envelope;
- observed timestamp, runtime status, duration, and retry count when present.
- serialized request/result byte counts when the provider record exposes the
  payload; the serialized content is discarded immediately.

Usage observations retain hashed provider event and session identifiers plus
input, cached-input, output, reasoning, and total token counts when present.
Claude and ZCode usage may be associated with the same hashed turn as one or
more tools. That is shared-turn association, not single-tool attribution. Codex
usage is a cumulative per-session rollup and is never projected onto one tool.

Provider health retains only provider state, stable error code, counts, and
timestamps. Source cursors retain a path hash, file identity, byte offset,
size, timestamps, and skipped-line counts. They do not retain the source path.
ZCode checkpoints retain only a hashed database identity, numeric scan
timestamps, and a numeric offset within the current timestamp tie. Provider row
identifiers are never stored in checkpoint form. The adapter treats the usage
tables as append-only event stores; terminal-state changes are read from their
completion timestamps.

Procedure observations retain hashed invocation identity, versioned Procedure
and implementation IDs, runtime outcome and timing, and stable error code.
Capability-stage observations retain versioned Capability, operation, and
provider IDs; binding transport and target; runtime status, duration, effects,
and stable error code. Receipt input/output digests are validated but not
stored.

Direct Runtime observations retain only hashed work-order/call identity,
versioned semantic target and provider identity, binding/contract digests,
terminal status and stable error code, timing, cold/warm session state, and
numeric serialized payload sizes. The Runtime event declares zero model calls
and leaves token and monetary cost null; the observer preserves that boundary.
Provider-native MCP observations keep `mcp-tool` distinct from
`mcp-operation`; the latter retains both carrier tool name and selected
operation id. Schema v11 migrates existing semantic rows without changing
their identities.

Imported Context Surface analyses retain source ID/revision, snapshot and
catalog digests, catalog/tool/schema byte counts, duplicate/collision counts,
and explicitly reported token measurements. Tool descriptions and schemas are
not copied into the observer. An import does not establish that the snapshot is
the currently installed catalog; that binding status remains `not_assessed`.

Legacy v0.2 receipts may still contain human-checkpoint stages. The portable
approval semantics behind them were removed from the Procedure standard on
2026-08-23, so the observer checks only the entry shape and discards it on
read. No checkpoint, approval, authority, decision-source, reviewer identity,
criteria, or evidence field is stored, aggregated, or reported, and the
observer never turns a recorded human decision into a correctness claim.

When a receipt declares an MCP binding target, the report may map matching
passive MCP names to that Capability and count `passiveObservedCalls`. The
mapping basis is recorded as `declared-receipt-binding-target`; it is usage
observation only and does not turn passive completion into conformance or
correctness.

## Report semantics

The current JSON report is
`openadam.agent-tool-observer.report.v0.3`. A snapshot without that exact
version is stale input and is rebuilt from the current database. v0.3 uses
`correctnessStatus` and `opportunityStatus`; both remain `unknown` unless a
separate current assessment owns the judgment.

The report emits these signals:

- `observed-use`: repeated calls exist, without claiming correctness or value;
- `fix-candidate`: enough measured calls exist and the observed runtime error rate is
  materially high;
- `insufficient-data`: the passive record cannot support a stronger claim.

`weaken-routing` and `retire-candidate` are intentionally unavailable from
passive metadata alone. A future opportunity classifier must first distinguish
tool availability, genuine opportunity, forced routing, natural routing, and
semantically comparable alternatives. Until then, the report recommends a
targeted controlled evaluation rather than a portfolio mutation.

Two discovery signals are deliberately weaker than recommendations:

- repeated MCP calls with no observed semantic binding become
  `candidate-for-capability-contract`;
- an identical 2–8 non-derived MCP sequence repeated in at least three turns
  across at least two hashed sessions becomes
  `candidate-for-procedure-evaluation`. Orchestration wrappers and statically
  derived nested names are excluded.

Both retain `correctnessStatus: unknown`. They nominate definition and
conformance work; they do not assert the observed sequence is the right method.

## Provider status

Every adapter reports one of:

- `ok`: the current source was read and normalized;
- `partial`: useful records were collected but bounded data was skipped or a
  source backlog remains;
- `missing`: the configured provider source is absent;
- `error`: the source exists but could not be safely read or parsed.

Unknown event records do not fail a provider. Malformed and over-limit lines
are counted without retaining their contents.

## Configuration

Production defaults are owner-local and require no setup. Tests and explicit
human invocations may override roots through `ATO_*` environment variables.
Overrides change only what this observer reads; they never grant write access
to a provider source.

`ATO_DIRECT_RUNTIME_LOGS` accepts an explicit platform-delimited list of exact
metadata-log paths. It does not accept a discovery root. The Direct Runtime
must separately be launched with `--observation-log` for events to exist.

## Non-goals for v0.1

- external installation, consent, upload, analytics service, or billing;
- screen, accessibility, network, process, or keystroke interception;
- notifications or automatic product changes;
- semantic prompt classification or LLM judging;
- public Dashboard, MCP server, plugin, or Skill;
- historical truth before the configured initial lookback window;
- cross-provider causal comparison or universal Tool Scores.
