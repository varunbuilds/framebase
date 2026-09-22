# Framebase --- Product Requirements Document

**Document status:** Initial MVP specification\
**Product name:** Framebase\
**Product type:** Browser-based collaborative video-editing prototype\
**Primary challenges:** Cardboard.ai #01 High Performance NLE in the Browser, #02 Collaboration, and #10 Version Control\
**Implementation order:** Video Editor → Collaboration → Version Control

------------------------------------------------------------------------

## 1. Product Overview

Framebase is a browser-based video-editing workspace where creators can
assemble a lightweight timeline, work together in real time, and
eventually explore alternate edits through branches and merges.

The product is designed to demonstrate three difficult video-workflow
problems:

1.  **High Performance NLE in the Browser (#01):** building a responsive
    browser-native editing foundation with deliberate media handling,
    timeline rendering, seeking, and compositing trade-offs.
2.  **Collaboration (#02):** synchronizing timeline state and user
    activity across clients while media remains client-side or
    separately hosted.
3.  **Version Control (#10):** creating and comparing alternate edits,
    then merging compatible work and resolving conflicts in an
    editor-friendly way.

Framebase is an MVP/prototype. It will use a constrained editing model
and sample media rather than attempting to replace a professional
non-linear editor.

## 2. Problem Statement

Video projects combine large media assets with complex editing state.
Synchronizing entire media files is inefficient, while synchronizing
timeline edits raises questions about concurrent changes, stale clients,
and conflicting operations.

Video workflows also lack a simple, familiar way to branch an edit,
compare two cuts, merge changes, and resolve conflicts without losing
work.

Framebase will demonstrate a practical approach by separating media
assets from structured timeline data, synchronizing the editing
document, and building video-aware version-control features on top of
it.

## 3. Goals

### Product goals

-   Deliver a visually polished browser-based timeline editor.
-   Let users arrange and make basic edits to video clips.
-   Enable two or more users to work in a shared project and observe
    updates.
-   Make collaborator presence visible.
-   Provide a foundation for independent branches and alternate cuts.
-   Compare timeline versions in terms creators understand.
-   Merge compatible changes and surface incompatible ones for
    resolution.

### Engineering goals

-   Represent the edit as structured data, not as a monolithic video
    file.
-   Use stable IDs for clips and tracks.
-   Model user edits as explicit operations.
-   Keep live collaborative state distinct from durable version history.
-   Keep media storage and timeline synchronization separate.
-   Handle reconnects and stale state deliberately.
-   Make limitations and conflict rules explicit.

## 4. Non-Goals

The MVP will not attempt to provide:

-   A full Premiere Pro, Final Cut, or DaVinci Resolve replacement.
-   Professional multi-track audio mixing or advanced audio automation.
-   Complex effects, keyframing, color grading, or motion graphics.
-   A production-grade rendering/export pipeline; the prototype may implement a constrained browser export path.
-   Guaranteed frame-accurate behavior across every browser and codec.
-   Uploading and synchronizing large raw media files through the
    realtime collaboration channel.
-   Unlimited project sizes or large-team collaboration.
-   A fully general-purpose Git implementation.
-   Automatic resolution of every possible semantic editing conflict.

## 5. Target Users and Primary Use Cases

### Target users

-   Independent creators experimenting with alternate cuts.
-   Small creative teams collaborating on a simple edit.
-   Developers evaluating collaboration and version-control concepts for
    media software.

### Core use cases

1.  A creator imports or opens sample media and assembles a sequence.
2.  A creator shares a project with a collaborator.
3.  Collaborators see timeline changes and presence updates.
4.  A creator saves a named checkpoint.
5.  A creator creates a branch to experiment with a different cut.
6.  A creator compares two branches and inspects their differences.
7.  A creator merges compatible changes or resolves conflicts manually.

## 6. Product Principles

-   **Timeline first:** editing state is a structured document.
-   **Media is separate:** synchronize references and edit metadata, not
    video bytes.
-   **Explicit operations:** changes should be representable as typed
    actions.
-   **Visible state:** make collaboration, branch context, and conflicts
    understandable.
-   **Safe experimentation:** users should be able to explore without
    silently destroying earlier work.
-   **Honest scope:** label prototype limitations rather than implying
    production readiness.
-   **Progressive complexity:** deliver the editor first, collaboration
    second, and version control third.

## 7. Agreed Technology Stack

### Frontend

  -----------------------------------------------------------------------
  Technology                          Responsibility
  ----------------------------------- -----------------------------------
  React                               Component-based editor UI

  Vite                                Frontend development and build
                                      tooling

  TypeScript                          Types for projects, tracks, clips,
                                      operations, and API boundaries

  Tailwind CSS                        Styling and responsive layout

  Zustand                             Local UI state, selection, panel
                                      state, and transient editor
                                      controls

  Zundo                               Selective undo/redo for meaningful
                                      editor mutations; exclude noisy
                                      playback and pointer-move updates

  Framer Motion                       Purposeful UI transitions and
                                      interaction feedback

  Mediabunny                          Media metadata, input/reading, and
                                      media-processing/export utilities
                                      where supported

  WebCodecs                           Low-level decode/encode building
                                      block for preview/export paths,
                                      used progressively and with
                                      capability checks

  WebGPU                              GPU-accelerated effects and
                                      compositing experiments; progressive
                                      enhancement with a fallback path

  HTML video element                  Initial playback fallback and
                                      compatibility path where appropriate

  Canvas and/or CSS                   Timeline tracks, clip blocks,
                                      ruler, playhead, and visual state
  -----------------------------------------------------------------------

### Backend and services

  -----------------------------------------------------------------------
  Technology                          Responsibility
  ----------------------------------- -----------------------------------
  Liveblocks                          Realtime shared editing state and
                                      collaborator presence

  Supabase Postgres                   Durable project records, branch
                                      metadata, snapshots, and version
                                      history

  Supabase Auth                       Authentication and user identity

  Supabase Storage                    Optional later-stage shared media
                                      storage

  Zod                                 Runtime validation for persisted
                                      and incoming data

  Node.js + TypeScript                Optional server-side logic if
                                      client-side operations are
                                      insufficient or privileged
                                      validation is needed
  -----------------------------------------------------------------------

### Local media and persistence

  -----------------------------------------------------------------------
  Technology                          Responsibility
  ----------------------------------- -----------------------------------
  File System Access API              Optional user-selected file/folder
                                      access, behind capability checks

  OPFS                                Browser-managed workspace/cache
                                      storage where supported

  IndexedDB                           Optional metadata, cache, and
                                      recovery support

  Sample video assets                 Initial shared demo media,
                                      accessible to both collaborators

  Supabase Storage                    Later option for uploaded media
                                      that collaborators can access
  -----------------------------------------------------------------------

### Architecture decisions

-   Liveblocks owns the live collaborative document/session state.
-   Supabase owns durable application records and version-control
    persistence.
-   Framebase owns timeline semantics, editing operations, branching,
    diffs, merge rules, and conflict-resolution UX.
-   Do not store full video bytes in Liveblocks shared state or timeline
    records.
-   Do not treat realtime broadcasts as durable history.
-   Establish one clear path for committing a collaborative state into a
    durable snapshot.
-   Do not duplicate the same mutable timeline as independently
    authoritative state in both Liveblocks and Supabase.

### Media technology implementation notes

- Use **Mediabunny** as the preferred media utility layer for metadata and supported media operations; verify its current API and codec/browser support during implementation.
- Use **WebCodecs** for lower-level frame decode/encode work when needed and supported. Treat codec availability as runtime-dependent rather than guaranteed.
- Introduce **WebGPU** incrementally for GPU-backed rendering/effects. Detect support and provide a simpler fallback; core editing must not depend on WebGPU being available.
- Use the **File System Access API** as an enhancement for user-selected local files/folders, not as the only import path.
- Use **OPFS** for browser-managed caches or workspace data where supported. Keep durable project/version records in Supabase.
- Use **Zundo** only for intentional editor actions. Avoid recording every playback tick, hover, drag intermediate, or other high-frequency transient update.
- Keep the initial MVP constrained: prioritize import, timeline editing, responsive preview, and stable project data before advanced effects or a sophisticated export pipeline.

## 8. High-Level Architecture

``` text
Browser Client A                         Browser Client B
React + Vite                             React + Vite
Editor UI                                Editor UI
Zustand UI state                         Zustand UI state
       \                                      /
        \---------- Liveblocks --------------/
                    Shared live document
                    Presence and updates
                            |
                     Framebase domain
                 Timeline operations/model
                  Validation and conflict rules
                            |
                         Supabase
                 Projects and memberships
                 Branches and snapshots
                 Version/merge metadata
                            |
                   Media references only
                            |
                 Sample media / later Storage
```

The architecture must distinguish: - **Transient UI state:** selected
clip, open panel, local drag preview, hover state. - **Collaborative
document state:** committed timeline edits and shared project editing
data. - **Durable version state:** snapshots, branches, merge records,
and restore points. - **Media assets:** source files, URLs, IDs, and
availability metadata.

## 9. Core Domain Model

The initial schema should be small but extensible. Exact field names can
be finalized during implementation, but preserve these concepts.

### Project

-   `id`
-   `name`
-   `ownerId`
-   `createdAt`
-   `updatedAt`
-   `activeBranchId` (where applicable)
-   `settings` (minimal project settings)

### Track

-   `id`
-   `name`
-   `kind` (initially video; optional audio/image support as scope
    permits)
-   `order`
-   `muted` or `locked` only if implemented in the MVP

### Clip

-   `id` --- stable identifier
-   `assetId`
-   `trackId`
-   `timelineStart`
-   `sourceIn`
-   `sourceOut`
-   `order` or equivalent ordering representation
-   `kind`
-   Optional display metadata such as label or thumbnail reference

### Media Asset

-   `id`
-   `name`
-   `mediaType`
-   `duration` when known
-   `source` or `storagePath`
-   `availability` state
-   Optional dimensions and thumbnail reference

The clip should reference an asset; it should not contain the media
bytes.

### Editing Operation

Operations should be typed and validated. Initial examples:

-   `addClip`
-   `moveClip`
-   `trimClip`
-   `reorderClip`
-   `deleteClip`
-   `addTrack` (only if track creation is included)

Each operation should include enough information to validate and
reconcile it, such as an operation ID, actor ID where appropriate,
target clip ID, and relevant before/after values. Avoid designing a
complex event-sourcing system prematurely.

### Version-control concepts (Phase 3)

-   **Snapshot:** immutable captured timeline state plus metadata.
-   **Branch:** named line of work with a base snapshot and current
    head.
-   **Diff:** semantic list of clip/track changes between two snapshots.
-   **Merge record:** source branch, target branch, result snapshot, and
    resolution metadata.
-   **Conflict:** incompatible changes to the same logical object or an
    invalid combined timeline state.

## 10. Functional Requirements

Priority labels: - **P0:** required for the prototype. - **P1:**
valuable if time permits. - **P2:** future enhancement.

### Phase 1 --- Video Editor

#### Layout and project shell

-   **P0** Provide a coherent editor workspace with a top bar,
    media/library panel, preview, timeline, and properties area.
-   **P0** Provide an example project that opens without requiring a
    user to upload footage.
-   **P0** Show the project name and current editing context.
-   **P1** Support responsive behavior for narrower screens, while
    prioritizing desktop.

#### Media and preview

-   **P0** Show the sample media library.
-   **P0** Allow a user to add a supported sample asset to the timeline.
-   **P0** Preview a selected source clip using browser media playback.
-   **P0** Display a clear empty state when no clip is selected.
-   **P1** Allow local media import for a single user's session, with an
    explicit note that local files are not automatically available to
    collaborators.
-   **P1** Show a missing-media or unavailable-media state when a
    referenced source cannot be loaded.

#### Timeline editing

-   **P0** Display tracks, clip blocks, a time ruler, and a playhead.
-   **P0** Add clips to the timeline.
-   **P0** Move clips along the timeline.
-   **P0** Reorder clips.
-   **P0** Trim a clip's source-in/source-out or duration within
    supported limits.
-   **P0** Delete clips.
-   **P0** Select a clip and display its editable properties.
-   **P0** Keep timeline state internally consistent after each
    operation.
-   **P1** Support undo/redo for local editor actions, with a design
    that can later integrate with multiplayer undo behavior.

#### Local project state

-   **P0** Maintain a structured project document.
-   **P0** Support creating or loading the sample project.
-   **P0** Separate transient UI state from project document state.
-   **P0** Define typed editing operations before collaboration is
    introduced.

**Phase 1 acceptance criteria**

-   A user can open the demo project and see media, preview, and
    timeline.
-   The user can add, move, trim, reorder, and delete clips.
-   The preview responds to the selected clip and basic playback
    controls.
-   The timeline remains valid after supported edits.
-   The project can be serialized and deserialized without losing its
    core clip/track data.
-   The codebase has stable IDs and typed operations for supported
    edits.

### Phase 2 --- Collaboration (#02) with Liveblocks

#### Shared projects and presence

-   **P0** A user can enter a shared project session.
-   **P0** Two browser clients can connect to the same project.
-   **P0** Display collaborator presence, such as participant names or
    avatars and connection state.
-   **P0** Synchronize supported timeline operations through Liveblocks
    shared state.
-   **P0** Reflect a collaborator's accepted edit in the other connected
    client.
-   **P1** Show a lightweight activity indicator, such as who is
    currently editing or selecting a clip.

#### Concurrent editing and recovery

-   **P0** Define behavior for simultaneous edits to the same clip.
-   **P0** Validate incoming operations against the current document.
-   **P0** Ensure duplicate delivery or retry does not unintentionally
    apply an operation twice where operation IDs are used.
-   **P0** Handle connection loss and reconnect by reconciling local
    state with the current shared document.
-   **P0** Display a meaningful error or status when an edit cannot be
    applied.
-   **P1** Provide a visible stale-state or resynchronization indicator.

#### Media behavior

-   **P0** Use demo media that both clients can access.
-   **P0** Synchronize media references and timeline edits, not media
    bytes.
-   **P0** Clearly indicate when a media asset is unavailable to a
    collaborator.
-   **P1** Support shared uploads through Supabase Storage only after
    the basic collaborative workflow works.

#### Persistence boundary

-   **P0** Persist project metadata and access information in Supabase.
-   **P0** Define how and when shared editing state is saved durably.
-   **P0** Keep realtime transport separate from durable version
    history.
-   **P1** Add recovery support for unexpected reloads or session
    interruption.

**Phase 2 acceptance criteria**

-   Two separate browser sessions can join the same project.
-   A supported edit in one session appears in the other without a
    manual refresh.
-   Presence reflects connected collaborators.
-   Concurrent edits follow documented rules rather than silently
    corrupting the timeline.
-   A reconnecting client can recover a valid current document.
-   Video files are not transmitted as part of ordinary timeline
    synchronization.

### Phase 3 --- Version Control (#10)

#### Snapshots and history

-   **P0** Create a named snapshot of a valid timeline state.
-   **P0** Display a project's snapshot history.
-   **P0** Open or preview a prior snapshot without unintentionally
    overwriting the current working state.
-   **P0** Restore a snapshot through an explicit action.
-   **P0** Store snapshot metadata and timeline content durably in
    Supabase.
-   **P1** Support descriptions or labels for snapshots.

#### Branches

-   **P0** Create a branch from a selected snapshot or branch head.
-   **P0** Give branches human-readable names.
-   **P0** Switch the working context between branches.
-   **P0** Preserve branch independence so edits on one branch do not
    silently mutate another branch's snapshot.
-   **P0** Display the active branch clearly.
-   **P1** Support branch deletion with appropriate safeguards.

#### Timeline diffs

-   **P0** Compare two snapshots or branch heads.
-   **P0** Identify added, deleted, moved, reordered, and trimmed clips
    where supported by the model.
-   **P0** Present differences visually on or alongside the timeline.
-   **P0** Allow a user to inspect a change and identify the affected
    clip.
-   **P1** Provide filters by change type.

#### Merge and conflict resolution

-   **P0** Merge compatible changes from one branch into another.
-   **P0** Detect at least the defined conflict cases, including
    incompatible changes to the same clip.
-   **P0** Present conflicts in understandable language with relevant
    before/after values.
-   **P0** Allow the user to choose a resolution for supported
    conflicts.
-   **P0** Produce a valid merged timeline and record the result.
-   **P0** Preserve source branches after a merge.
-   **P1** Offer a merge preview before applying the merge.

**Phase 3 acceptance criteria**

-   A user can create a named snapshot and see it in history.
-   A user can branch from a snapshot and edit independently.
-   The diff view identifies supported timeline changes.
-   Compatible changes can be merged.
-   Incompatible changes are surfaced rather than silently discarded.
-   A user can resolve supported conflicts and produce a valid result.
-   The merge result and relevant metadata are persisted.

## 11. UX and Visual Direction

The interface should feel like a focused modern creative tool rather
than a generic admin dashboard.

### Design requirements

-   Desktop-first workspace with a clear hierarchy.
-   Light-first visual design unless implementation testing suggests
    otherwise.
-   Neutral surfaces, subtle borders, restrained shadows, and deliberate
    spacing.
-   Clear distinction between media library, preview, timeline, and
    inspector.
-   Clip blocks should communicate selection and edit state clearly.
-   Use motion to clarify actions, not as decoration that slows editing.
-   Presence indicators should be visible but unobtrusive.
-   Branch and version context must always be clear.
-   Conflict states should explain the issue and available choices
    without alarming or vague language.
-   Include loading, empty, error, disconnected, and missing-media
    states.

### Key screens

1.  **Editor workspace**
2.  **Shared session / collaborator presence**
3.  **Version history panel**
4.  **Branch selector and branch creation**
5.  **Timeline diff view**
6.  **Merge preview and conflict resolution**

The editor workspace is the first screen to build. Version-related
screens should be introduced in Phase 3.

## 12. Data and Synchronization Rules

-   The project timeline is structured data.
-   Each clip and track has a stable ID.
-   Media assets are separate entities referenced by clips.
-   All supported edits should map to explicit operations.
-   Validate operation inputs and resulting document invariants.
-   Define deterministic behavior for operations that affect the same
    clip.
-   Treat client-local drag previews and hover/selection states as
    transient unless intentionally shared.
-   Do not assume a successful realtime broadcast means data has been
    durably saved.
-   Define a persistence/commit boundary between the live collaborative
    document and snapshots.
-   On reconnect, reconcile against the current shared state and surface
    unrecoverable errors.
-   Branch snapshots should be immutable; edits create a new working
    state rather than mutating historical snapshots.
-   Merge operations should preserve source history and create a
    distinct result.

## 13. Security and Access

-   Use Supabase Auth for user identity.
-   Enforce project membership and permissions before allowing access.
-   Do not expose service-role credentials in the browser.
-   Configure Supabase Row Level Security for protected database
    records.
-   Validate access to Liveblocks rooms using an appropriate server-side
    authorization mechanism.
-   Treat client-supplied actor IDs and permissions as untrusted.
-   Keep secrets in environment variables and document required
    variables in `.env.example`.
-   Do not store sensitive user data in presence metadata.

## 14. Suggested Data Persistence Shape

This is a starting point, not a requirement to create every table
immediately.

-   `profiles` --- user-facing profile metadata, if needed.
-   `projects` --- project name, owner, timestamps, and settings.
-   `project_members` --- membership and role information.
-   `media_assets` --- asset metadata and storage references.
-   `snapshots` --- immutable snapshot metadata and serialized timeline
    state.
-   `branches` --- branch name, project ID, base snapshot, and current
    head.
-   `merge_records` --- source/target branches, result snapshot, and
    resolution metadata.

For Phase 1, local/sample project state is sufficient. Introduce
database tables as their corresponding functionality is implemented.
Avoid building unused schema prematurely.

## 15. Milestones and Delivery Sequence

### Milestone 1 --- Editor foundation

-   Establish app shell and visual design.
-   Define domain types and validation.
-   Implement sample project and media library.
-   Build preview and basic timeline.
-   Implement clip operations.
-   Serialize/deserialize the project.

**Exit gate:** A single user can make supported edits to a valid
timeline.

### Milestone 2 --- Multiplayer collaboration

-   Configure Liveblocks.
-   Add shared project sessions and presence.
-   Connect supported operations to shared state.
-   Define concurrent edit behavior.
-   Implement connection and reconnection states.
-   Establish durable project persistence in Supabase.

**Exit gate:** Two users can make supported edits in one shared project
and observe consistent updates.

### Milestone 3 --- Version control

-   Implement snapshots and history.
-   Add branch creation and switching.
-   Implement semantic timeline diffs.
-   Implement merge rules and conflict presentation.
-   Persist branch and merge metadata.
-   Test restore and recovery flows.

**Exit gate:** Users can branch, compare, merge, resolve supported
conflicts, and restore prior work.

## 16. Testing Strategy

### Unit tests

-   Timeline invariants and validation.
-   Clip add/move/trim/reorder/delete operations.
-   Serialization and deserialization.
-   Diff classification.
-   Merge compatibility and conflict detection.
-   Snapshot immutability.

### Integration tests

-   Liveblocks room state updates.
-   Operation validation and rejection.
-   Reconnect reconciliation.
-   Supabase persistence and access control.
-   Snapshot creation and restore.
-   Branch and merge persistence.

### Manual acceptance tests

-   Open and edit the sample project.
-   Open the same project in two browser sessions.
-   Make edits in each session and observe synchronization.
-   Disconnect and reconnect one session.
-   Create a snapshot and branch.
-   Make divergent edits and compare the results.
-   Merge compatible edits.
-   Resolve a conflicting edit.
-   Restore a previous snapshot.
-   Test a missing or inaccessible media reference.

## 17. Risks and Mitigations

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Scope expands into a full video     Keep editing operations and
  editor                              supported media types limited

  Realtime synchronization becomes    Start with a small operation set
  complex                             and explicit conflict rules

  Live state and persisted state      Define ownership and a clear
  diverge                             snapshot/persistence boundary

  Media is unavailable to             Use shared demo assets first and
  collaborators                       show missing-media states

  Version-control implementation      Limit the first diff and merge
  becomes too broad                   model to supported clip operations

  Database schema is overbuilt early  Add durable tables incrementally as
                                      features arrive

  Browser media behavior varies       Document supported formats and
                                      treat preview as a prototype
                                      capability

  UI polish consumes implementation   Build a consistent component system
  time                                and prioritize core flows
  -----------------------------------------------------------------------

## 18. Definition of Done for the MVP

The MVP is considered demonstrable when:

-   A user can edit a sample video timeline in the browser.
-   Two users can collaborate on the same project through Liveblocks.
-   Shared edits and presence are visible and understandable.
-   The app distinguishes shared timeline data from local UI state and
    media files.
-   Users can save snapshots and create independent branches.
-   Users can compare branches using timeline-aware diffs.
-   Compatible changes can be merged.
-   Supported conflicts can be resolved explicitly.
-   Project/version data is persisted securely.
-   The app documents limitations around media handling, rendering,
    concurrency, and supported edits.

## 19. Cursor Implementation Instructions

When using this PRD to implement Framebase:

1.  Implement **only Phase 1** initially unless explicitly instructed
    otherwise.
2.  Do not build collaboration or version-control UI before the editor
    foundation is functional.
3.  Create reusable, typed domain models and explicit editing operations
    from the start.
4.  Keep components modular and avoid putting the entire editor in one
    component.
5.  Use realistic sample data and polished empty/loading/error states.
6.  Do not invent backend capabilities or pretend realtime sync is
    implemented before Liveblocks is integrated.
7.  Do not introduce unnecessary services or paid APIs.
8.  Keep media bytes out of collaborative state.
9.  Make reasonable implementation decisions without repeatedly asking
    for approval on routine details.
10. At the end of each milestone, summarize what is implemented, what
    remains, and any known limitations.

------------------------------------------------------------------------

**End of PRD**
