# Shreditor Agent process

This document specifies the intended workflow. It does not establish which capabilities have been implemented.

## Operating loop

**Agent edits. User reviews and tweaks.** Both work on the same editable project. Every agent pass begins from the latest saved state, produces a concrete change, and leaves a playable result with enough context to review it. Manual edits become part of the next agent pass.

Keep the loop short: inspect → plan → edit → verify → review → revise. Ask only for missing information that materially affects the requested result. Routine, reversible edits and local previews should proceed within the user's request. A request to adjust one detail should preserve unrelated editorial choices.

## Establish the edit

Read the current project, requested changes, available media, and existing review notes. Identify the deliverable, audience, dimensions, duration, must-keep moments, intended sound, and supplied brand references. Separate explicit requirements from open creative choices.

Inspect actual source frames and listen to relevant audio before choosing cuts. Metadata can establish dimensions or duration; it cannot establish meaning, delivery, or whether an action completes. Keep a compact source log with asset identity, source interval, observed content, and reason to use it. Record any source that could not be viewed or heard.

Preserve original media. New projects need a fresh destination. Existing projects should be modified only when the request identifies them as the intended continuation. Keep authoring, review, revision history, previews, and final output together under one project root.

## Plan around the material

For each beat, decide whether the point is best carried by footage, footage with graphics, or a full graphic scene. Choose the treatment from the evidence and message. Graphics should clarify, direct attention, compare, or explain. Preserve footage that carries the point without decoration.

Use a proportional plan:

| Field | Required content |
|---|---|
| Edit interval | Position and duration in the finished sequence. |
| Source interval | Asset and selected source moment. |
| Viewer takeaway | What becomes clear in this beat. |
| Treatment | Framing, graphic mechanism, and relevant text. |
| Sound | Dialogue, music, source sound, added cue, or intentional silence. |

For music-led work, inspect and audition the selected music segment before assigning picture timing. Record source time, project time, confirmed musical event, and visual arrival. Peaks are investigation candidates; they are not confirmed beats.

For speech-led work, preserve complete thoughts and natural breathing. Inspect waveforms around proposed boundaries and listen to the surrounding words. Quiet amplitude alone does not justify removal. Keep useful handles, verify every changed join with music muted, then listen in the full mix.

For an opening that needs a hook, consider distinct ideas grounded in actual footage, proposition, and evidence. Select one clear focal idea. Preview the opening together with its handoff into the body before polishing the rest. Effects and sound should strengthen the chosen idea.

## Coordinate agent work

When multiple agents contribute, assign bounded responsibilities such as source inspection, editorial planning, graphics, sound, or verification. Each assignment should state the current project revision, permitted scope, required evidence, and expected output.

Use one coordinator to reconcile the results and one writer for each shared document at a time. Specialists should return observations or proposed operations rather than independently replacing shared project state. Parallel analysis can proceed across independent assets; dependent edits must apply in an explicit order.

The coordinator must check that proposed changes refer to the current project and do not conflict with manual changes or other accepted work. Agent completion is not review evidence: inspected artifacts and actual findings must accompany any claim that a check passed.

## Make edits concrete

Represent an edit pass as operations against stable project and element identities. Capture the expected project revision, affected elements, requested operation, proposed values, and intended outcome. Read-only planning should expose before/after state and a readable diff without changing the project.

Before publishing a batch, resolve references, validate all operations, and apply them to temporary state in sequence. Later operations should see the results of earlier ones. Reject ambiguous identities, invalid timing, missing assets, and unintended overlap before writing.

Publish through the same mutation layer used by the interface. Check the expected revision immediately before writing. A stale operation must return a conflict with enough information to rebase; it must not silently overwrite the user's newer work.

Record a receipt containing the affected files or document, previous and resulting revisions, operation identifiers, and restoration data. Undo should restore the complete logical batch and verify that the current state still matches it. Multiple-file writes require individual atomic replacements and explicit rollback behavior; do not describe them as one indivisible transaction unless the storage layer provides that guarantee.

## Verify while constructing

Save the project before generating review media. Previews must correspond to the saved revision. After a coherent visual change, inspect its entrance, movement, readable hold, exit, and neighboring cuts. Use a sequence overview for coverage and full-size frames for small text, crops, masks, or edge detail.

Open the actual rendered images. Identify problems by time and element, correct the editable source, and render the affected interval again. A file path or successful render is not a visual review.

Play changed intervals at normal speed with sound. Check continuity, complete words and actions, synchronization, reading time, and mix balance. For talking heads, compare eye position and framing across cuts without chasing natural head movement. Recheck neighboring cuts after reframing.

Verification notes should identify the project revision, inspected interval, artifact, checks performed, findings, fixes, and unresolved limits. Distinguish automated validation from visual inspection and listening.

## Present the review

Bring the user to a playable result at the changed interval. Keep selection and time references stable between the change list, timeline, inspector, and preview. Show concise descriptions of meaningful changes and any actionable failures. Detailed diagnostics should remain available without dominating the editing flow.

Allow the user to adjust the project directly or request another agent pass. The next pass must inspect those changes before acting. A user's tweak is current project state, not an exception to an older plan.

## Finish and resume

Export only from the intended saved revision. Verify the final encoded file, including its audio and ending. Keep the editable project, matching output, useful previews, and meaningful history together. Report actual limitations, including unreviewed audio or unsupported output requirements.

Leave enough state to continue: current revision, accepted decisions, completed checks, open findings, and the last reviewed interval. Preserve useful history while removing disposable intermediates. Final delivery should not create a detached second workspace that loses the editable history.
