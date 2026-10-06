# Shreditor system structure

This specification defines the proposed relationship between Shreditor Agent and Shreditor UI. It describes responsibilities and boundaries for implementation; it does not claim these components already exist. The central workflow is: the agent edits a project, the user reviews the result, and either actor can continue editing the same durable source.

## Responsibilities

Shreditor Agent interprets a request, inspects the current project and capabilities, plans a bounded change, and submits operations through the shared editing service. It gathers review evidence and reports the resulting revision, changes, failures and unresolved decisions. It must refresh its context when another actor changes the project. Its working notes and plans are separate from project content.

Shreditor UI presents the project, selection, playhead, editable properties, preview, history and job status. It turns gestures into operations, keeps temporary interaction drafts separate from committed edits, and exposes conflicts without discarding either actor’s work. Selection, viewport and panel state belong to the interface; changing them does not modify the authored composition.

Both actors use the same editing authority. Neither gains an independent path that silently replaces the other’s changes.

## Editable project model

A project has a stable identity, a current revision and one or more addressable documents. Each document declares its canvas, duration, composition hierarchy and source representation. Objects, assets, animation tracks and keyframes have stable identities independent of their names or positions in a list.

The editable model distinguishes visual structure, appearance, timing, animation, media references and audio behavior. It retains relationships such as parent transforms, grouped content, masks and property dependencies. Every supported change must preserve unrelated data, including fields the editing interface does not expose.

Assets are stored within the project or referenced through a managed asset inventory. That inventory records identity, location, media metadata and provenance where available. A reference becomes usable only after its bytes are available and validated. Importing media is distinct from placing it into a composition.

The project retains enough authored structure for later manual changes. Flattened previews and finished videos are derived artifacts; they do not replace the editable document.

## Document adapters

Adapters connect the shared project services to different source representations. They expose inspection, capabilities, validation, mutation, serialization and evaluation through a common boundary while retaining representation-specific details.

A native document adapter operates on structured layers, properties, effects and animation data. An HTML document adapter operates on source elements, styling, declared variables and animation definitions. Both map interface selections and agent targets to stable source identities. An HTML edit must survive reloading and timeline seeking rather than modifying only the displayed page.

Adapters must describe unsupported operations and conversion limits. They must not imply that every representation supports identical features or that conversion is lossless. Source-specific operations can remain explicit when a common operation would conceal meaningful differences.

## Shared mutation service

The mutation service owns the transition between project revisions. Each request identifies the project, document, target objects, expected starting revision, actor and intended operation. Validation checks capabilities, identity, asset references and document invariants before publishing a change.

Related operations may form one transaction and one history entry. A continuous gesture remains a draft until committed or cancelled. The service serializes conflicting work and rejects stale requests with enough current information for recovery. It does not interpret a cancellation request as proof that a previously dispatched change was reversed.

A completed mutation returns a receipt distinguishing rejection, application, persistence and verification. Receipts connect changes to their history entries and subsequent artifacts. External file changes enter through the same revision reconciliation process. Pending edits must be preserved before a reload or conflict resolution.

## Clocks and evaluation

The time model explicitly separates project time, parent-local time, animation time and source-media time. Units and conversion rules are declared at each boundary. Moving a clip, trimming source content and changing playback speed are different operations.

Nested playback mappings determine how a project timestamp reaches a child or source frame. Animation evaluation must work at arbitrary timestamps, allowing scrubbing and rendering without relying on the order in which earlier frames were visited. Edits to animated properties identify whether they change a keyframe, a base value or the complete motion.

## Preview, rendering and persistence

Preview evaluates a specified document revision at a specified time. The interface tracks requested and completed frames so an older result cannot be presented as evidence of a newer change. Interactive drafts may appear immediately, but their status remains distinct from committed source.

Rendering produces output from a captured revision and declared output settings. Audio and video evaluation share an explicit clock relationship. Preview playback controls do not silently alter authored audio settings.

Persistence serializes and durably stores a captured revision. Edits made after capture remain unsaved until another successful write. Failures preserve recoverable state. Saving, completing a preview and exporting a video are separate operations with separate completion evidence.

## Jobs and artifacts

Long-running imports, renders and exports are jobs with stable identities, captured inputs, progress and explicit terminal states. Cancellation records what stopped and whether outputs remain usable. Retries retain their relationship to the original request without confusing earlier outputs with the current result.

Artifacts record project revision, producing job, relevant timestamps, settings and storage location. Review images, playback files and exports stay associated with their editable source. The handoff identifies the current project, completed evidence and outstanding work. User acceptance is separate from technical completion and does not prevent further editing.
