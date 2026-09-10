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

Semantic input has three distinct paths. Direct Runtime collection reads only
its exact optional metadata log and accepts only the closed
`openadam.direct-execution-observation.v0.1` event shape. Static Context Surface
measurement and Agent Host deployment observation are explicit bounded imports.
None of these paths scans arbitrary output directories or discovers installed
tool catalogs. Retired pre-release Procedure receipts are not accepted.

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

The configured total byte and row/line budgets are apportioned across every
enabled source family, including ZCode and Direct Runtime. A failed source
consumes its allocation conservatively so later sources cannot turn parser or
schema failures into an unbounded scan. No process listens for connections or
remains resident between scans.

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
not copied into the observer. An import alone does not establish that the
snapshot is the currently installed catalog; that binding status remains
`not_assessed`. A matching explicit Agent Host deployment observation changes
it to `matched-current-agent-host-deployment` for that exact source, revision,
and catalog digest.

Agent Host deployment observations retain only release/channel/profile
identity, immutable component versions and artifact digests, declared tool
names, activation/observation timestamps, and the matching catalog identity and
sizes. Refreshing one unchanged activated deployment advances its observation
timestamp in one semantic row instead of creating a row per refresh. No
component path, command, task content, tool arguments, or result is stored. The
latest observation is the current correlation basis; it does not prove host
health or task quality.

Tool events retain provider-scoped session-start observations when the provider
record exposes them: the Codex session metadata timestamp, the earliest
timestamp observed in one Claude session log, or ZCode `session.time_created`
when that table and field exist. A tool call becomes a current-release
correlation candidate only when that observed start is at or after release
activation and its tool name maps to a declared binding. This is not causal
attribution and does not prove which catalog the host actually loaded. Calls
from pre-activation sessions and calls with an unknown start remain separate.

Fresh-session routing observations retain only hashed session/turn identifiers,
tool names, order/counts, route classes, terminal status, and numeric retry
signals. The report discloses the 50,000 source-event scan bound, the 100
returned-record bound, and whether either bound truncated the projection; the
returned record count is not labeled as total turns. These records do not
retain prompts, commands, arguments, results, or a judgment of whether the task
should have used the tool.

## Report semantics

The current JSON report is
`openadam.agent-tool-observer.report.v0.6`. A snapshot without that exact
version is stale input and is rebuilt from the current database. v0.6 uses
`correctnessStatus` and `opportunityStatus`; both remain `unknown` unless a
separate current assessment owns the judgment. It removes the legacy
receipt-derived `procedures` and `capabilities` projections; current semantic
execution observations come only from Direct Runtime metadata.

The report emits these signals:

- `observed-use`: repeated calls exist, without claiming correctness or value;
- `high-observed-error-rate`: at least five measured calls exist and the
  observed runtime error rate is at least 20%;
- `insufficient-data`: the passive record cannot support a stronger claim.

The report has no repair, Capability, Procedure, routing, ranking, weakening,
or retirement candidate fields. A user or user-selected Agent may use the
measurements as one input to a separate assessment, but this Observer does not
select that assessment or its next action.

Two repeated-pattern observations remain deliberately non-semantic:

- repeated MCP calls with no observed semantic binding become
  `repeated-unmapped-mcp-use`;
- an identical 2–8 non-derived MCP sequence repeated in at least three turns
  across at least two hashed sessions becomes
  `repeated-tool-sequence`. Orchestration wrappers and statically
  derived nested names are excluded.

Both retain `correctnessStatus: unknown` and
`interpretationStatus: not-performed`. They do not nominate definition,
conformance, repair, or productization work.

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
Provider-source overrides must be absolute and unambiguous; unknown disabled
provider names fail closed instead of silently leaving collection enabled.
Overrides change only what this observer reads; they never grant write access
to a provider source.

`ATO_DIRECT_RUNTIME_LOGS` accepts an explicit platform-delimited list of exact
metadata-log paths. It does not accept a discovery root. The Direct Runtime
must separately be launched with `--observation-log` for events to exist.

`ATO_RETENTION_DAYS` defaults to 45 and must be at least the configured report
lookback. Explicit maintenance deletes expired event rows, preserves the latest
Context Surface measurement per source and the current Agent Host deployment,
then checkpoints and compacts SQLite. Provider cursors and health state remain.

## Non-goals for v0.1

- external installation, consent, upload, analytics service, or billing;
- screen, accessibility, network, process, or keystroke interception;
- notifications or automatic product changes;
- semantic prompt classification or LLM judging;
- public Dashboard, MCP server, plugin, or Skill;
- historical truth before the configured initial lookback window;
- cross-provider causal comparison or universal Tool Scores.
