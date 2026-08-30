# Review contract

## Privacy and authority

1. Production code has no networking import, URL-based source, listener, or
   model invocation.
2. Provider files and databases are opened read-only. Tests compare source
   bytes before and after collection.
3. Source discovery never follows symlinks and accepts only regular `.jsonl`
   files beneath exact configured roots.
4. Persisted schemas contain no prompt, message, reasoning, path, command,
   argument, input-content, result, output-content, or error-message fields.
5. All source/session/turn/call/message identifiers are context-hashed before
   insertion. Unknown strings from records are not copied into health errors.
6. Explicit Procedure Receipt files are bounded regular non-symlinked files.
   Receipt invocation IDs are hashed; input/output payloads and digests are not
   persisted. Only versioned semantic IDs, bindings, runtime state, duration,
   effects, and stable error codes may enter semantic event tables.
7. Receipt formats v0.1/v0.2 are legacy. v0.2 human-checkpoint stages are
   structurally checked and discarded on read; no checkpoint, approval,
   authority, decision-source, or reviewer state is persisted, aggregated,
   or reported. Reviewer authentication was never an observer capability.
8. Direct Runtime input is an exact owner-only regular JSONL file. Events use a
   closed versioned schema and contain only hashed execution identity, semantic
   target/provider identity, state, timing, digests, session state, and numeric
   payload sizes. A projected MCP target retains both tool and operation id;
   schema migration preserves earlier semantic rows. Unknown fields or versions
   fail closed before cursor advance.
9. Context Surface input is one explicit bounded Analyzer result. Tool catalog,
   descriptions, and schemas are not persisted, and import never claims the
   snapshot matches the current installed host.
10. Agent Host deployment input is one explicit bounded regular non-symlinked
    file with a closed schema. It may store release/component/tool-binding and
    catalog identities, but never component paths, commands, task content,
    arguments, or results. Duplicate semantic tool bindings fail closed.
    Re-observing one unchanged activated deployment updates its observation
    timestamp without accumulating another semantic row.

## Bounds

1. One run has limits for files, total bytes, bytes per source, lines, line
   bytes, JSON depth, and wall time. Total byte and line/row allocations span
   every enabled source family; a failed source conservatively consumes its
   allocation before a later source is considered.
2. A partial final JSONL line does not advance the cursor.
3. An over-limit line is discarded through its newline without constructing an
   unbounded string and increments a skipped count.
4. File truncation or replacement resets the read offset; event IDs keep
   ingestion idempotent.
5. Provider failure is isolated and reported with a stable code. One provider
   cannot overwrite another provider's health.
6. A settled ZCode source produces zero observer event writes; rows that move
   from running to a terminal state are still refreshed incrementally.
7. ZCode queries use bounded pages shared across tool and model streams. A
   timestamp tie larger than one page progresses through a numeric tie offset
   without storing a provider row identifier.
8. Direct Runtime JSONL uses the same line, depth, byte, wall-time, replacement,
   incomplete-line, and idempotency bounds as other JSONL sources.
9. Retention is at least the report lookback. Maintenance deletes only expired
   event rows, preserves each source's latest Context Surface row and the
   current Agent Host deployment, checkpoints the WAL, and compacts SQLite.
10. Shared-turn usage association remains indexed by provider, turn, and time;
    report generation must not degrade into an unindexed event cross-product.

## Claims

1. Runtime completion is never labeled correctness, success, usefulness, or
   verification.
2. Missing status, latency, retry, usage, opportunity, availability, and
   routing data remain unknown rather than zero.
3. Zero calls never create `weaken-routing` or `retire-candidate`.
4. A fix candidate requires a minimum measured-call count and observed runtime
   error rate. The report exposes the counts supporting the signal.
5. Passive output can request a targeted `agent-tool-evals` comparison but
   cannot run one automatically.
6. Repeated unmapped MCP use and repeated tool sequences may only nominate a
   Capability-contract or Procedure evaluation. Both keep correctness unknown.
7. Passive Capability call counts may be mapped only from a binding target
   declared by a legacy receipt. The observer records that name association as
   a mapping observation only; it cannot establish provider conformance, task
   opportunity, or correctness.
8. Human acceptance and rejection fields in legacy receipts are discarded.
   They cannot establish current authority or quality; the current owning
   business system controls its decisions. Reports must keep
   `correctnessStatus` equal to `unknown`.
9. Tool payload bytes are measurements, not content or cost. Turn token totals
   are labeled shared association and never allocated to one tool. Monetary
   cost remains unavailable without compatible model and pricing identity.
10. Direct Runtime metadata establishes only what that runtime reports about a
    call. Context Surface import establishes only measurements of the named
    explicit snapshot. Neither establishes current installation, correctness,
    value, opportunity, routing quality, authorization, or general benefit.
11. A matching Agent Host deployment observation establishes only one declared
    release binding. A current-release correlation candidate requires a
    provider-scoped recorded session start at or after activation and a matching
    declared tool name; this is not causal attribution or proof of the catalog
    loaded by that host. Codex session metadata, the earliest observed Claude
    session-record timestamp, and ZCode `session.time_created` are distinct
    declared bases. Pre-activation and unknown-start calls remain separate.
    Bounded fresh-session tool order can report first-tool, preceding
    shell/orchestration, retry, error, and observed recovery metadata, but the
    report must expose both its source-event and returned-record bounds and must
    not label the returned record count as total turns. It does not establish
    opportunity, routing quality, task correctness, or user value.

## Automatic installation

1. Install preflight verifies the fixed absolute Node path and copies the
   package manifest plus runtime source into an owner-only content-addressed
   directory. The copy is rehashed before the plist is written.
2. The plist has no socket, network, shell, model, or tool-repository mutation
   action. It invokes only quiet `collect` with fixed absolute arguments;
   successful scheduled runs do not grow an append-only result log.
3. State and log directories, log files, and snapshots are owner-only; the
   plist is owner-writable only.
4. Installation is idempotent and verifies the loaded LaunchAgent after
   bootstrap.
5. Uninstall stops only the exact observer label and preserves collected state.
6. The LaunchAgent path must resolve inside the installed runtime digest, never
   the mutable development checkout. A source edit cannot change the loaded
   program until an explicit reinstall selects a new digest.
7. Command-specific and duplicate CLI options fail before action. In
   particular, `--dry-run` cannot be silently ignored by collect, ingestion,
   uninstall, or purge.

## Required validation

- unit and integration tests for all three adapters;
- repeat collection with no duplicates;
- append-after-partial-line sequence;
- malformed, huge-line, truncation, replacement, and symlink cases;
- source-byte conservation;
- schema/privacy and network-import contract checks;
- command-specific option, duplicate-option, configuration spelling, and
  cross-provider total-budget regressions;
- current-size report-query baseline plus shared-turn index presence;
- CLI smoke with fixture providers;
- Direct Runtime success, provider error, host error, sink failure, schema
  drift, projected-operation identity, schema migration, privacy, payload-byte,
  and idempotency cases;
- explicit Context Surface import, deduplication, and no-catalog-retention case;
- Agent Host deployment ingestion, semantic refresh deduplication, provider
  session-start coverage, bounded-routing disclosure, exact release
  correlation, unknown-field, duplicate-binding, privacy, and stale-catalog
  cases;
- retention preview/application, latest-snapshot preservation, WAL checkpoint,
  and database compaction cases;
- wrapper/derived-sequence negative regression;
- content-addressed installation immutability regression;
- installed `launchctl` state plus a new automatic collection timestamp;
- unchanged Git status fingerprints for every pre-existing tool repository.
