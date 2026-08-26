# PRD / Spec: VoicePrompter Web App Upgrade

**Status:** Draft — approval required before planning or implementation  
**Surface:** `https://tele.alphasync.dev/app/`  
**Scope:** Cloud script sync, script library, in-session teleprompter UX, and voice-tracking reliability

## Objective

Upgrade the VoicePrompter web app from a local, flat recent-scripts experience into a reliable production teleprompter that:

1. keeps a user's scripts available across their sessions/devices without exposing them to other users;
2. lets users organize, find, update, favorite, and delete scripts deliberately;
3. makes a live recording/reading session easier to operate without losing eye contact; and
4. recovers from normal spoken deviations without unpredictable jumps or stalls.

The primary user is a creator recording a talking-head video or live presentation from a desktop or mobile browser. Success means the live `/app/` experience works on `tele.alphasync.dev`, remains usable when offline, and does not regress existing Google Docs import, scrolling modes, mirror modes, video mode, or PWA behavior.

## Current State and Evidence

- The web app is a Vite multi-page PWA; `/app/` is its PWA start and scope (`vite.config.ts:26-79`).
- `src/main.ts:228-321` tokenizes a loaded script, detects language, renders it, and currently auto-saves every edit after 600 ms (`src/main.ts:409-417`).
- The unstaged Convex work already adds `scripts` fields for title, content, preview, timestamps, Google Doc source, word count, favorites, and one tag (`convex/schema.ts`). CRUD and upsert mutations exist (`convex/scripts.ts:8-189`), but the browser storage adapter exposes only list/save/clear (`src/storage.ts`).
- Existing recent scripts are a horizontal, click-to-load list; no per-script actions exist (`src/render.ts:301-338`).
- Voice matching takes the last five recognized tokens, searches only forward from the current word within the configured lookahead, and deduplicates the immediately previous match (`src/speech.ts:37-251`; `state.config.lookaheadWords` defaults to 5 in `src/state.ts`).

## Product Requirements

### 1. Private Cloud Sync and Offline Continuity

- A saved script must belong to exactly one user or private sync identity. A browser must never receive, mutate, or enumerate another user's script.
- Saving a script must create or update the selected script by stable script ID — never by matching entire content.
- Editing an existing script must preserve its identity, title, favorite state, tags, Google Docs source, and settings unless the user explicitly changes each field.
- The library must load cloud data when the user is online and show a truthful sync state: synced, saving, offline/pending, or failed.
- When offline or the sync service is unavailable, creating/editing/reading scripts must still work locally. Pending changes must reconcile once the client reconnects.
- A user must be able to safely delete one script. Bulk deletion is out of scope for this upgrade unless explicitly requested.
- Existing locally stored scripts must be migrated once, idempotently, after the user establishes a sync identity; no automatic upload of scripts to a shared or anonymous backend.

### 2. Script Library

Replace the flat “Recent scripts” list with a library that supports:

- a persistent title (defaulted from the first non-empty line only when creating a script);
- full-text filtering over title and content preview;
- favorite/unfavorite;
- optional tags (multiple tags are not required in this release);
- script metadata: last updated time, word count, favorite state, tag, and Google Docs provenance where present;
- explicit rename, duplicate, and delete actions with accessible labels and confirmation before delete;

The library is a management surface, not a collaboration system: no sharing, folders, versions, roles, or public links in this release.

### 3. Live Prompter Session UX

While reading a script, the interface must expose a low-distraction session HUD that shows:

- progress as `current speakable word / total speakable words` and percentage;
- estimated remaining time when using constant or sound scrolling, calculated from remaining speakable words and configured scroll speed;
- an indeterminate/no-estimate state for voice scrolling (rather than a fabricated duration);
- accessible controls to restart and move one paragraph backward/forward;
- a clear current-mode and listening/paused status.

The HUD must remain usable in portrait, landscape, video split/overlay modes, and the existing iOS full-screen/scroll-lock behavior. It must not intercept script-word tap targets, obstruct the camera preview, or expose a fixed control bar that makes small mobile screens unusable.

### 4. Voice Tracking Reliability

Improve word matching without changing the app’s browser-native speech-recognition dependency:

- Normalize recognition and script tokens consistently using Unicode letters/numbers and case folding.
- Match ordered runs of recent spoken tokens against a bounded search region around the current position, rather than advancing on any isolated common word.
- Prefer the nearest forward ordered match; allow a bounded backward correction only when a multi-word match provides stronger evidence than the current position.
- Ignore bracketed cues, emoji, line-break markers, and stop markers as the current parser does.
- Preserve explicit voice commands (`go start`, `go finish`, `go next`, `go back`) and prevent command words from being consumed as script text when a command is triggered.
- Make tracking sensitivity configurable through the existing settings model, with a conservative default that avoids jumps on common words.

This is deterministic client-side matching. It does not add audio recording/transcription upload, server-side AI, or an LLM.

## Non-Goals

- Native iOS, Android, Windows, or macOS app changes.
- Social/collaborative script sharing, team workspaces, roles, or public script links.
- Cloud-hosting audio, video, recognition transcripts, or recordings.
- Replacing browser SpeechRecognition with a new recognition provider.
- Reworking landing pages, marketing copy, or SEO except for a minimal factual mention if a visible web-app capability changes.
- Unrelated refactors of the existing video, Google Docs, PWA, and settings systems.

## Technical Direction

### Client and UI

- Keep the existing Vite + TypeScript + vanilla DOM architecture; feature code belongs in the existing `src/` modules, not a new UI framework.
- Expand `HistoryItem` into a stable script-library model keyed by its persistent cloud/local ID. The ID must never be derived from `Date.now()` during read mapping.
- Split persistence responsibilities into a small repository interface: local cache/outbox, remote sync adapter, and script library operations. Existing callers should use one library API, not query Convex directly.
- Update the existing `renderHistoryList` rather than maintaining a second rendering pattern.
- Derive progress from the existing `state.currentIndex` and `state.scriptWords`, excluding skipped/non-speakable entries.

### Data and Sync

- Before enabling cloud sync, add an identity and authorization boundary to every Convex query/mutation, and index records by owner plus sorting/search fields as needed.
- Use stable IDs and explicit create/update mutations. Do not use content-equality as a primary key because editing text otherwise creates a second record.
- Store only script text and metadata required by this PRD; recognition audio remains on-device.
- Treat the remote backend as a sync target, not an availability prerequisite. The local cache/outbox is the source of continuity while offline.

### Voice Tracking

- Extract pure token-normalization and candidate-selection functions from `src/speech.ts`; this enables deterministic unit coverage without instantiating browser recognition.
- Score bounded candidate windows by consecutive ordered token matches, proximity, and direction. Reject weak one-word matches where the token is common/ambiguous.
- Keep candidate window sizes bounded so recognition processing remains cheap on long scripts.

## Commands

```bash
# Install dependencies
npm install

# Run the local development server
npm run dev

# Produce the production build (also generates changelog/blog/use-case assets)
npm run build
```

No repository-standard unit-test script exists in `package.json` today. The implementation plan must introduce focused deterministic tests only for the new persistence and matching contracts, then record their exact command in this section.

## Boundaries

### Always

- Preserve user scripts on sync/network failure and clearly communicate sync status.
- Keep all recognition audio in the browser; do not transmit it.
- Maintain the existing Google Docs, video, PWA, mirror, language, and scrolling-mode behaviors.
- Validate the deployed `/app/` flow in a real browser, including a cloud-sync path, offline path, and a voice-matching scenario.
- Keep the Convex backend private; do not publish it through Cloudflare.

### Ask First

- Selecting the cloud identity model and any authentication provider.
- Changing the Convex schema or deploying its functions.
- Adding a new runtime dependency.
- Publishing a route or proxy that changes how public browser clients reach the backend.
- Deleting or migrating any existing saved script data.

### Never

- Store scripts in an unscoped shared table exposed to all visitors.
- Put a Convex admin key, tunnel credential, or other secret in browser code, a tracked `.env*` file, or build output.
- Expose the private Convex backend directly through a public Cloudflare route.
- Make cloud availability a requirement to open/read a locally cached script.
- Add silent script deletion, upload recognition audio, or alter native apps as part of this work.

## Success Criteria

1. **Privacy and identity:** A signed-in/private-sync user can list and mutate only their own scripts. A request made without the required identity receives no other user’s data.
2. **Cloud continuity:** Create, rename, edit, favorite, tag, duplicate, delete, and reopen a script; reload the browser and open the app on a second authenticated session; the expected library state is present exactly once.
3. **Offline continuity:** Disable network, create and edit a script, open and read it, restore network, and observe the queued operations sync without loss or duplicate creation.
4. **Library usability:** A library containing at least 20 scripts can filter by title/preview, open a result, and perform the required item actions by keyboard and pointer.
5. **Session UX:** During a constant-scroll session, progress and remaining estimate update as the script advances. During voice/sound sessions, progress updates while the estimate is explicitly unavailable. Paragraph/restart controls work in narrow portrait and landscape layouts.
6. **Voice tracking:** Automated pure-function cases cover punctuation/case normalization, ordered forward advancement, ad-lib noise, repeated words, weak common-word rejection, bounded backward recovery, skipped cues, and commands. In a browser smoke test, speaking a short altered phrase does not cause an unbounded jump.
7. **Regression and delivery:** `npm run build` succeeds. The upgraded app is deployed to `tele.alphasync.dev/app/` and manually verified in a browser against the configured backend without exposing it publicly.

## Critical Open Decision: Cloud Identity and Reachability

The current Convex functions have no user/owner argument or authorization boundary (`convex/scripts.ts`), and the current browser adapter queries the app-wide `scripts` table (`src/storage.ts`). Shipping that as cloud sync would expose every visitor’s scripts to every other visitor.

The existing backend is intentionally private/Tailscale-only. A public browser at `tele.alphasync.dev` therefore cannot be assumed to reach it directly. We need one approved design before planning:

1. **Authenticated personal library (recommended):** add user authentication and server-enforced ownership; use a narrowly scoped public app-facing sync/API layer that brokers only authenticated script operations to the private Convex backend. The backend itself remains private.
2. **User-managed encrypted sync vault:** create a per-user client-held sync secret and encrypt script payloads end-to-end before a broker stores them. This avoids traditional accounts but adds key recovery/usability complexity and still needs a carefully bounded public broker.
3. **Private-only web app:** keep the app restricted to authenticated tailnet users and use Convex identity tied to that access model. This conflicts with the current public `tele.alphasync.dev` usage unless that is intentional.

The implementation must not begin until this decision is approved, because it determines the schema, API surface, migration, and live verification path.

## Approval Requested

Approve this PRD and select one Cloud Identity and Reachability option above. After approval, the next gate is a technical plan in `tasks/plan.md` and dependency-ordered implementation checklist in `tasks/todo.md`; implementation and deployment follow only after you approve that plan.
