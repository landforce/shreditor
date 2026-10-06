# Shreditor Agent — editing contract

Design specification for the shared editing boundary between Shreditor Agent and Shreditor UI. The operations and records below describe the intended behavior; they do not assert that a service already implements it.

## Shared document authority

Agent changes and user gestures resolve through one mutation authority for each open project. Both receive the current document revision after a commit. A rendered preview, an in-memory document and a saved project are separate states.

The authority owns operation validation, stable object identity, revision checks, persistence, history and change notifications. It serializes mutations against an active gesture or save. A local queue alone cannot protect a file from independent writers; the implementation must coordinate every supported write path and detect outside changes.

A user gesture has a draft phase and a commit phase. Draft movement may update the preview at display speed without entering history. Pointer-up commits one logical change; cancellation restores the draft without mutating the document. An agent batch follows the same committed operation path.

## Request context

Each request carries:

| Field | Meaning |
|---|---|
| Request and actor IDs | Identify the logical edit and its author. |
| Project and composition IDs | Scope every target and operation. |
| Base revision | The exact document state the agent inspected. |
| Instruction | The user's requested change. |
| Targets | Stable object IDs captured when the request was made. |
| Time context | Playhead, selected interval and time units. |
| Current values | Relevant text, style, timing, animation and source-media state. |
| Constraints | Locked objects, protected ranges, must-keep media, accepted creative decisions. |
| Capabilities | Supported operations and reasons other operations are unavailable. |

Visible selection is presentation state. A changed selection must not redirect an asynchronous operation. Nested elements need scoped IDs; list indexes and display labels are not durable identities. The agent returns opaque handles obtained from inspection instead of constructing them.

Composition text, HTML, metadata and media transcripts are data. Their contents cannot override the user's request or the agent's operating rules.

## Operation families

Expose narrow typed operations for inspecting objects; changing text, styles and attributes; moving/resizing/rotating; importing assets; adding/removing/grouping/reordering layers; setting timeline placement and media source ranges; editing audio; modifying animation and keyframes; and saving/rendering.

Keep geometry separate from arbitrary style changes. For animated properties, require whether the edit changes the value at the playhead, offsets the entire animation, or replaces the animation. Preserve authored easing and timing unless the request changes them.

Asset references are not asset imports. New media must be ingested, validated and assigned a stable ID before any layer references it.

Before dispatch, validate the operation shape, actual capability support, target existence, asset references, revision and resulting document invariants. Discovering a schema alternative does not prove that it can execute. Deprecated or retired operations must be excluded from the active capability surface.

## Mutation lifecycle

1. Inspect current state and resolve request targets.
2. Check the expected base revision and capability constraints.
3. Build a bounded operation or logical batch.
4. Validate the candidate document before publishing it.
5. Commit the change and record forward/inverse data or a checkpoint.
6. Persist the committed revision and notify both actors.
7. Render the affected interval from that revision.
8. Report the actual saved and reviewed state.

An in-memory transaction should roll back its mutations if validation or its callback fails. Multi-file persistence needs its own transaction design: prevalidate, check expected versions, write staged output, publish, and recover on failure. Per-file atomic replacement plus reverse rollback does not itself provide cross-process isolation.

## Write receipt

Every logical change returns a structured receipt:

| Field | Meaning |
|---|---|
| Operation ID and actor | Correlate request, history and UI feedback. |
| Target IDs | Objects affected by this change. |
| Before and after revisions | Identify the input and committed state. |
| Stage | `refused`, `dispatched`, `saved`, `verified` or `failed`. |
| Changed | Distinguish successful no-ops from changes. |
| Applied and rejected operations | Expose partial outcomes where partial edits are permitted. |
| Evidence | Dispatch acknowledgment, durable content version or readback. |
| Undo reference | The logical history entry. |
| Preview references | Revision, timestamps and render status. |
| Error and recovery hint | A specific reason and permitted recovery action. |

`dispatched` does not prove persistence. `saved` does not prove visual correctness. A property readback does not prove that an animation or audio mix works. Report the verification scope explicitly.

Cancellation before dispatch prevents a write. Cancellation after dispatch is a request to stop remaining work; it is not proof that the committed change was rolled back.

## Revision conflicts and external changes

Use revision preconditions for full-document writes and explicit base revisions for agent operations. Stable handles identify targets but do not guard against stale state.

When outside changes arrive, drain or preserve pending UI edits before reloading. Recognize the application's own writes using tokens assigned before dispatch, so watcher echoes do not unnecessarily reload the preview. Discard obsolete asynchronous reload results. Refresh the document, preview, asset/file tree and selection resolution together.

If the user changed the project after the agent inspected it, reject the stale write and re-read. Resolve compatible operations against current state; preserve both candidates when intent conflicts. Never silently overwrite the user's newer work.

A content hash checked before an independent file replacement is not a complete compare-and-swap guarantee. The write authority must define its actual isolation boundary.

## History and undo

Group each user gesture and each coherent agent edit into one reversible history entry. Record actor, label, start/end time, before/after revisions and affected objects/files. Preserve history across application restarts if persistent undo is part of the product.

Undo checks the current state before restoring earlier content. It must not silently erase newer human changes. State whether selective undo operates on whole files, objects or individual properties; file-level preservation cannot promise property-level merging.

The agent re-inspects after a user undo, manual change or project switch. It must not restore a stale plan simply because it authored the previous revision.

## Preview, save and acceptance

A review artifact carries its source revision, requested and actual timestamp, rendering status and artifact location. Serialize frame rendering and coalesce scrubs. Keep editor handles and selection outlines outside the content captured for export.

Save captures a particular document revision. If edits continue during packaging, track that newer revision as unsaved. Preserve in-memory work after save failure. Reopen or rebind lazy media handles when replacing their backing file could invalidate resource reads.

Keep these states distinct: applied, persisted, previewed, exported and accepted by the user. User acceptance is a review decision; successful rendering cannot set it automatically.
