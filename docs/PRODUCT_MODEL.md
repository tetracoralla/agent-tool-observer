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
6. writes bounded metadata-only status and 30-day report snapshots;
7. records independent provider health and exits.

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

Usage observations retain hashed provider event and session identifiers plus
input, cached-input, output, reasoning, and total token counts when present.

Provider health retains only provider state, stable error code, counts, and
timestamps. Source cursors retain a path hash, file identity, byte offset,
size, timestamps, and skipped-line counts. They do not retain the source path.
ZCode checkpoints retain only a hashed database identity, numeric scan
timestamps, and a numeric offset within the current timestamp tie. Provider row
identifiers are never stored in checkpoint form. The adapter treats the usage
tables as append-only event stores; terminal-state changes are read from their
completion timestamps.

## Report semantics

The report emits these signals:

- `observed-use`: repeated calls exist, without claiming correctness or value;
- `fix-candidate`: enough measured calls exist and runtime error evidence is
  materially high;
- `insufficient-data`: the passive record cannot support a stronger claim.

`weaken-routing` and `retire-candidate` are intentionally unavailable from
passive metadata alone. A future opportunity classifier must first distinguish
tool availability, genuine opportunity, forced routing, natural routing, and
semantically comparable alternatives. Until then, the report recommends a
targeted controlled evaluation rather than a portfolio mutation.

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

## Non-goals for v0.1

- external installation, consent, upload, analytics service, or billing;
- screen, accessibility, network, process, or keystroke interception;
- notifications or automatic product changes;
- semantic prompt classification or LLM judging;
- public Dashboard, MCP server, plugin, or Skill;
- historical truth before the configured initial lookback window;
- cross-provider causal comparison or universal Tool Scores.
