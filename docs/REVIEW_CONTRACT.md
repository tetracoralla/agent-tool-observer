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
7. v0.2 checkpoint criteria and evidence digests are validated and discarded.
   Stored checkpoint metadata may say only that human authority was declared;
   reviewer authentication remains a host responsibility.

## Bounds

1. One run has limits for files, total bytes, bytes per source, lines, line
   bytes, JSON depth, and wall time.
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
7. Passive Capability call counts may be mapped only from an explicit receipt
   binding target. This establishes a declared name association, not provider
   conformance, task opportunity, or correctness.
8. Human checkpoint acceptance and rejection remain authority decisions, not
   objective quality scores. Reports must keep correctness evidence unknown.

## Automatic installation

1. Install preflight verifies the fixed absolute Node path resolves to a regular
   executable and the observer CLI is a regular, non-symlinked readable file
   before writing the plist.
2. The plist has no socket, network, shell, model, or tool-repository mutation
   action. It invokes only quiet `collect` with fixed absolute arguments;
   successful scheduled runs do not grow an append-only result log.
3. State and log directories, log files, and snapshots are owner-only; the
   plist is owner-writable only.
4. Installation is idempotent and verifies the loaded LaunchAgent after
   bootstrap.
5. Uninstall stops only the exact observer label and preserves collected state.

## Required validation

- unit and integration tests for all three adapters;
- repeat collection with no duplicates;
- append-after-partial-line sequence;
- malformed, huge-line, truncation, replacement, and symlink cases;
- source-byte conservation;
- schema/privacy and network-import contract checks;
- CLI smoke with fixture providers;
- installed `launchctl` state plus a new automatic collection timestamp;
- unchanged Git status fingerprints for every pre-existing tool repository.
