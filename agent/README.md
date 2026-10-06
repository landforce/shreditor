# Shreditor Agent

Companion to **Shreditor UI**.

**Agent edits → user reviews and tweaks → agent continues from the current project.**

This package defines prompts, workflows, document responsibilities and editing contracts. It is a design specification; the agent service is not implemented here.

## Package

| Document | Contents |
|---|---|
| [Prompts](./prompts.md) | Coordinator, scene worker, repair and scoped-edit templates; durable brief and continuation rules. |
| [Process](./process.md) | Inspect, plan, edit, validate, review, revise and hand off. |
| [Structure](./structure.md) | Agent/UI responsibilities, editable project model, adapters, mutation authority and job lifecycle. |
| [Editing contract](./editing-contract.md) | Request context, typed operations, revision checks, receipts, undo, conflicts, save and acceptance. |
| [Rendering](./rendering.md) | Time models, seekable animation, preview, assets, audio, export and verification. |
| [Composition action reference](./composition-actions.reference.schema.json) | Reference action shapes and definitions for native composition editing. |

## Agent and UI boundary

Shreditor Agent owns interpreting the request, inspecting the current project, planning scoped changes, issuing edits, checking results and reporting what was completed.

Shreditor UI owns direct manipulation, playback, selection, review and user tweaks. Both operate on one current project through a shared mutation authority.

The agent receives stable targets and the revision it inspected. A user change invalidates stale assumptions. Every committed edit is reversible, attributed and tied to a saved revision. A preview records which revision and timestamp it shows.

## Working records

Keep the brief, source inventory, edit plan, review findings and current revision with the project. Record accepted decisions once. Preserve the user's manual changes when the agent resumes.

A change receipt distinguishes refusal, dispatch, persistence, verification and failure. Applied, saved, rendered, exported and accepted are separate states.

## Reference schema

The composition action JSON is a design reference, not the final Shreditor API. It contains 99 action alternatives and 230 definitions, including deprecated or retired alternatives. Filter operations against actual adapter capabilities and validate document invariants before execution. Descriptive metadata has been normalized; operation shapes remain reference material.

The proposed contracts and prompt templates have not been exercised by an end-to-end agent service.
