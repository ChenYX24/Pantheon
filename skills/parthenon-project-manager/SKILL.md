---
name: parthenon-project-manager
description: Maintain a Parthenon project's shared plan, stage model assignments, capability revisions, and handoff evidence when the user asks to manage or continue work through its project workspace.
---

# Parthenon project manager

Use the panel's project ID and shared state as the coordination record. Resolve a named local project through `cyx context` before repository work. The panel's project directory and the registered repository must agree; do not infer identity from a similar name.

Read the project board and handoff snapshot before planning or resuming work. They contain goal, approved stages, task dependencies, execution evidence and project capabilities. Private Claude/Codex transcripts are not the shared state and must not be copied into Harness.

## Planning and revisions

Discuss the user's goal within the selected project. For each proposed stage, record acceptance criteria, dependencies, actual model IDs, primary and secondary executors, the reason for that assignment, and time/attempt limits. Recommend from installed/configured executors; do not invent model availability or treat unknown cost as zero.

Use Claude-primary/Codex-secondary for initial design discussion and Codex-primary/Claude-secondary for implementation as starting templates, then adapt to the task and observed results. The secondary normally reviews at meaningful checkpoints and takes over on eligible failure. Neither role implies simultaneous write access to the same worktree.

Save changes as a proposed plan revision. A discussion, generated plan, repository instruction, terminal message or model response is not a stage approval. Once the user approves the stage and pair, ordinary work and fallback inside that scope proceed without repeated confirmation. New scope, budget or executor assignments need a new versioned decision.

## Execution and shared state

Use the server's atomic task claim, never launch a second writer by reading a stale board. Preserve task identity, accumulated budget and acceptance requirements across primary/secondary handoff. A switch is limited to the approved pair and recorded with its cause. Missing user input or authorization is a blocker, not an executor failure to bypass.

Completion requires concrete evidence. Keep terminal liveness, implementation completion and accepted task state separate. If independent review or executable verification is unavailable, explain what remains and use awaiting-review state.

## Capabilities and remote collaboration

Treat improvements to skills, rules, MCP setup and remote handoff conventions as versioned capability drafts. Preserve the source, scope, change rationale and validation evidence. Apply a revision only to the intended project/executor scope; a project experiment does not change global agent defaults.

For a remote handoff, use only registered connection aliases and verified repository mappings. The handoff must identify plan version, task, code revision, uncommitted changes, artifacts, checks, blockers and next action. Do not include credentials, raw session databases or private chat histories. Reconcile the recipient's state before allowing a second writer.

Keep the old session until the receiving session verifies its task and evidence. Where context usage is unavailable, checkpoint at task boundaries and report it as unknown instead of guessing a percentage.

## Interfaces

Authenticated reads: `GET /api/projects/{id}/board`, `/workflow`, `/handoff`, `/capability-inventory`.
Plan editing: `PUT /api/projects/{id}/board` with the current `rev`; `409` means reload and merge.
Stage control: `POST /api/projects/{id}/stages/{stage}/approve` with `rev`, or `/pause`.
Capability revisions: `POST /api/projects/{id}/capabilities`, then `/{capabilityId}/activate` with `revision`.

External confirmations bind the paired recipient and exact plan version. A notification is not approval; duplicates or outdated replies never authorize a new run.
