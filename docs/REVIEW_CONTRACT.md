# Review contract

Review the current observer as one passive collection, local persistence,
reporting, and scheduled-runtime product. This contract records durable claim
boundaries and high-risk seams; it is minimum coverage, not a reasoning script
or completion runway.

Before following the named checks, reconstruct the current supported source
families, explicit import surfaces, schemas, report fields, retention behavior,
and installed LaunchAgent from source and runtime. Perform and report at least
one independent discovery route derived from those current surfaces rather
than from this file, test names, prior findings, or the changed-file list.
Completing every item below cannot by itself end the review.

## Privacy and authority

1. Production code has no networking import, URL source, listener, or model
   invocation.
2. Provider files and databases are opened read-only. Source discovery never
   follows symlinks and accepts only regular files beneath exact configured
   roots. Tests compare representative source bytes before and after collection.
3. Persisted schemas contain no prompt, message, reasoning, path, command,
   argument, input/result content, output content, or provider error message.
   Source, session, turn, call, and message identifiers are context-hashed
   before insertion.
4. Direct Runtime input is an exact owner-only regular JSONL file with a closed
   versioned schema. It retains only hashed execution identity, semantic target
   and provider identity, state, timing, digests, session state, and numeric
   payload sizes. A projected MCP target retains tool and operation identity.
5. Context Surface and Agent Host deployment imports each accept one explicit,
   bounded, regular non-symlinked file with a closed schema. They do not retain
   raw catalogs, schemas, component paths, commands, task content, arguments, or
   results. Duplicate semantic tool bindings fail closed.
6. Retired pre-release Procedure receipt and human-checkpoint formats are not
   accepted or projected. Existing private legacy database rows may remain
   untouched until ordinary retention removes them; they are not a current
   product source or report authority.

## Whole-run bounds and recovery

1. One collection run has cumulative limits for files, bytes, bytes per source,
   lines or rows, line bytes, JSON depth, and wall time across every enabled
   source family. A failed source conservatively consumes its allocation.
2. Partial final JSONL lines do not advance cursors. Over-limit lines are
   discarded through their newline without constructing an unbounded string.
3. Truncation or replacement resets the read position; stable event identities
   keep re-ingestion idempotent.
4. Provider failures remain isolated with stable codes. A settled ZCode scan
   writes no new events, while terminal-state transitions still refresh.
   Timestamp ties larger than one page progress through the bounded numeric
   offset without persisting provider row identifiers.
5. Retention is not shorter than report lookback. Maintenance preserves the
   latest Context Surface measurement per source and current Agent Host
   deployment, checkpoints the WAL, compacts SQLite, and reports exact eligible
   rows before mutation.
6. Shared-turn usage queries remain indexed by provider, turn, and time; report
   generation must not degrade into an event cross-product.

## Claim boundary

1. Runtime completion is never labeled correctness, usefulness, verification,
   adoption, or user value. Missing status, latency, retry, usage, opportunity,
   availability, routing, token, and cost data remain unknown rather than zero.
2. Zero calls never create routing, repair, or retirement semantics. A high
   observed error-rate signal requires the declared minimum measured-call count
   and observed runtime error rate, with those counts exposed; it remains a
   measurement rather than a repair instruction.
3. Passive unmapped MCP use and repeated tool sequences retain only neutral
   repeated-pattern names. They cannot nominate a Capability, Procedure,
   evaluation, repair, route change, or standard.
4. Payload bytes are measurements, not content or cost. Turn token totals are
   shared associations, never allocated to one tool. Monetary cost remains
   unavailable without compatible model and pricing identity.
5. Direct Runtime metadata establishes only what that runtime reported. Context
   Surface import measures one explicit snapshot. Agent Host deployment import
   declares one release binding. None independently establishes installation,
   causation, correctness, opportunity, routing quality, authorization, or
   benefit.
6. Fresh-session correlation uses each provider's declared session-start basis,
   keeps pre-activation and unknown-start calls separate, and discloses source
   and returned-record bounds. Returned records are not total turns or causal
   attribution.
7. Report schemas and renderings reject `fixCandidates`,
   `capabilityCandidates`, `procedureCandidates`, `weakenRoutingCandidates`,
   and `retireCandidates`. Interpretation and action remain owned by the user
   or user-selected Agent.

## Automatic installation

1. Install preflight verifies the fixed absolute Node path, copies the package
   manifest and runtime source into an owner-only content-addressed directory,
   rehashes the copy, and only then writes the plist.
2. The LaunchAgent has no socket, network, shell, model, or tool-repository
   mutation. It invokes only quiet collection with fixed absolute arguments;
   successful runs do not grow an append-only result log.
3. State, logs, snapshots, and plist permissions remain owner-only. Install is
   idempotent and verifies the loaded service. Uninstall stops only the exact
   Observer label and preserves local observations.
4. The loaded program resolves inside the installed runtime digest rather than
   a mutable checkout. Source edits cannot change automatic collection until an
   explicit reinstall selects a new digest.
5. Command-specific, duplicate, retired, and misspelled CLI options fail before
   action; `--dry-run` cannot be silently ignored by collection, ingestion,
   uninstall, or purge.

## Validation lanes

- **Development regression:** current registered source adapters and explicit
  importers; repeat collection; partial, malformed, oversized, truncated,
  replaced, and symlinked sources; source-byte conservation; schema/privacy and
  network-import checks; cumulative budgets; query-index baseline; CLI smoke;
  Direct Runtime schema drift and privacy; Context Surface and Agent Host
  imports; retention, WAL checkpoint, compaction, and immutable installation.
- **Installed automatic runtime:** loaded LaunchAgent path and digest, current
  scheduled collection timestamp, provider coverage, bounded snapshots, and
  non-resident behavior between runs.
- **Provider coverage and reports:** derive the current source list from code and
  runtime rather than a fixed adapter count. State freshness, truncation, and
  unknown fields explicitly.
- **Owner business acceptance:** whether the passive portfolio view changes a
  useful decision remains owner judgment, separate from the lanes above.

Every PASS names the current command or flow and observable. Report concrete
cross-repository implications when found, including any Agent Host schema consumer,
Capability/Procedure boundary, installed-runtime, or shared-resource concern.
