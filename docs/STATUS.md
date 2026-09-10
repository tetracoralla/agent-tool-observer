# Current status

Verified on 2026-08-31 on the owner Mac.

## Development regression: PASS

- `npm run check`: PASS;
- 55 Node tests cover the Codex, Claude, ZCode, and Direct Runtime adapters;
  privacy projection; incremental cursors; malformed, oversized, partial,
  replaced, and symlinked sources; conservative reports; schema migration;
  installed-runtime rendering; content-addressed installation; and retention;
- command-specific and duplicate CLI options now fail before action, so an
  ignored `--dry-run` cannot uninstall or purge data;
- provider-source overrides require absolute paths and misspelled disabled
  provider names fail closed;
- one run's byte and line/row allocations now span every enabled source family,
  including failed sources, ZCode, and Direct Runtime;
- production-source checks confirm no networking modules, dynamic evaluation,
  or third-party runtime dependencies;
- fixture CLI smoke completes collection, status, report, and privacy checks.

## Installed automatic runtime: PASS for current dogfood 0.2.0

- LaunchAgent label: `com.openadam.agent-tool-observer`;
- schedule: run at login and every 300 seconds as one short-lived collector,
  with no `KeepAlive`;
- current loaded program is the owner-only content-addressed Observer 0.2.0
  component from artifact
  `sha256:6b29cf337ab103a1e9afd4781c64ae11d359112f7f948719a263ad1a4815ff79`,
  using the Agent Host Suite's fixed Node 22.22.1 runtime;
- the latest installed collection completed with Codex, Claude, ZCode, and
  Direct Runtime all `ok`, no backlog, and zero Observer network/model calls;
- the SQLite database, status/report snapshots, plist, and logs remain
  owner-only; the service is not resident between scans;
- report v0.6 is active. Action-bearing portfolio candidate fields are absent;
  repeated patterns and high runtime error rates remain neutral observations.
  The retired pre-release receipt importer is absent,
  legacy Procedure/Capability tables contain zero rows, and semantic execution
  reporting comes only from Direct Runtime metadata.

## Provider and Host coverage

- the current database contains 148,011 tool events, 13,603 usage events, and
  1,083 Direct Runtime semantic execution events;
- the current Agent Host deployment observation is
  `local-dogfood-20260831.30` / suite `0.1.2-dogfood.30`;
- the installed Host snapshot reports all four Observer sources `ok` and keeps
  historical calls separate from current-release adoption or task quality;
- the current installed Agent catalog is 64,804 canonical UTF-8 bytes across
  nine Agent-visible tools, within the declared 65,536-byte limit, with no hard
  name collisions;
- provider session-start coverage and fresh-session adoption remain explicitly
  unobserved for this release rather than being inferred from historical calls.

## Performance and resource baseline

- default 30-day status/report reads use the owner-only snapshots;
- on a read-only copy of the current 93 MB database, the custom 29-day report's
  shared-turn association query took about 5.76 seconds before the new indexes;
  with the repaired provider/turn/time indexes it took 38–47 ms, and the full
  report took about 287 ms;
- creating those additive indexes on the copied current-size database took
  about 262 ms. There is no product SLO, so these are current baselines rather
  than a universal performance guarantee.

## Privacy and side effects: PASS

- zero Observer network calls and zero model calls;
- no prompts, messages, reasoning, source paths, project paths, commands, tool
  arguments/results, or provider error text in the persisted schema;
- provider sources are read-only and source-byte conservation is covered by
  integration tests;
- installer and snapshot failures report committed Observer-side effects
  explicitly.

## Claim boundary

The current report supports observed-use and runtime-error signals. Its
fresh-session and bounded-routing fields are deterministic correlations, not an
adoption, opportunity, causation, correctness, or task-quality assessment.

## Business/experience acceptance

Pending owner use after the installed Agent Host Suite update. No external
telemetry service is part of this product.
