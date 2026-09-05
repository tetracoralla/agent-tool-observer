# Agent Tool Observer repository contract

Current source ownership is [agent-tool-observer in Agent Host](https://github.com/tetracoralla/agent-host-suite/tree/main/packages/agent-tool-observer).
This repository retains historical source. Apply new implementation and release
work in Agent Host; the contract below describes this retained implementation.

Read `docs/PRODUCT_MODEL.md` and `docs/REVIEW_CONTRACT.md` before changing
provider adapters, storage, automatic collection, privacy projection, or claim
language.

- This repository owns passive, owner-local observation of Agent tool-use and
  model-usage metadata from explicitly supported client stores.
- It must not modify observed client stores, evaluated tool repositories,
  plugin installations, prompts, routing rules, or Agent behavior.
- Keep the collector local-only. Production source must not import networking
  modules, open a listener, upload data, or call a model.
- Never persist prompts, message text, reasoning, tool arguments, tool results,
  shell commands, error messages, project paths, or source paths. Parse only
  long enough to project bounded metadata, then discard the source record.
- Hash session, turn, call, message, and source identifiers before storage.
  Tool names and provider names are the only ordinary source strings retained.
- Provider adapters are read-only and failure-isolated. Codex and Claude JSONL
  readers skip symlinks, bound bytes and line sizes, retain partial-line
  cursors, and tolerate unknown records. ZCode opens its SQLite store read-only
  and must never copy raw provider metadata or error text.
- Automatic collection is a macOS LaunchAgent that invokes a short-lived
  incremental scan. It is not a network service and must not remain resident.
- Passive observations may identify use, reliability, latency, and cost
  signals. They may not infer correctness, missed opportunities, natural
  preference, redundancy, or retirement from absence or completion alone.
- `agent-tool-evals` remains a separate bounded causal evaluator. This project
  may recommend a targeted evaluation but must not run model-backed experiments
  automatically.
- Treat `observed`, `completed`, `error`, and `cancelled` as transport/runtime
  states, not semantic correctness. Missing measurements remain `null`, never
  zero.
- Use one deterministic core for CLI reports and automatic collection. Do not
  add an MCP/plugin surface until repeated use proves shell access is a routing
  cost.
- Add the smallest negative regression for parser drift, truncation, symlink
  traversal, identifier leakage, duplicate ingestion, source mutation, lock
  overlap, report overclaiming, and installation changes.
- Do not restore the retired pre-release Procedure receipt or human-checkpoint
  importer. Current semantic execution observations come from Direct Runtime's
  closed metadata event; existing legacy database rows are migration residue,
  not a product input or report authority.
- Do not commit, push, publish, notify, delete history, or modify another
  repository without explicit owner authorization.

Review the current product before applying the review contract and include one
independent discovery route. Report development regression, installed automatic
runtime, provider coverage, and owner business acceptance separately.
