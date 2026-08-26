# VoicePrompter Upgrade — Implementation Tasks

**Plan:** [`tasks/plan.md`](plan.md)  
**Spec:** [`docs/specs/teleprompter-upgrade.md`](../docs/specs/teleprompter-upgrade.md)  
**Status:** Awaiting plan approval

## 1. Secure gateway and Google authentication

- [ ] **Create the sync gateway service and secure runtime configuration**
  - Acceptance: Google ID tokens are verified server-side; session is an HttpOnly secure cookie; unauthenticated requests cannot use any script route; no secret is tracked in the repository.
  - Verify: gateway authentication contract tests and manual invalid-token/no-cookie requests.
  - Files: new scoped gateway service directory, deployment/service configuration, `.env.example` with names only (no values).

- [ ] **Deploy the gateway without exposing Convex**
  - Acceptance: the dedicated gateway URL is reachable over HTTPS; its tunnel reaches only the gateway; Convex remains limited to private Tailscale/LAN reachability.
  - Verify: browser sign-in preflight; unauthenticated gateway denial; public Convex route check.
  - Files: homelab service/tunnel configuration outside this repository; deployment notes in repository.

## 2. Owner-scoped Convex data model

- [ ] **Migrate Convex scripts to owner-scoped stable records**
  - Acceptance: every script belongs to an authenticated gateway-derived owner; owner-scoped list, create, update, duplicate, delete, and batch-sync operations exist; content equality is no longer the record identity.
  - Verify: deploy functions to self-hosted Convex; gateway tests show user isolation and cross-user `404` behavior.
  - Files: `convex/schema.ts`, `convex/scripts.ts`, generated Convex bindings as required.

- [ ] **Add typed script and API contracts**
  - Acceptance: browser and gateway agree on stable script IDs, metadata, partial updates, operation idempotency, errors, and sync state.
  - Verify: compile-time typecheck and API contract tests.
  - Files: shared/new contract modules, gateway routes, `src/types.ts`.

## 3. Local-first persistence and safe migration

- [ ] **Implement IndexedDB cache and ordered outbox**
  - Acceptance: script reads and edits work offline; every pending create/update/delete gets persisted before sync; replay is idempotent and reconciles canonical records.
  - Verify: deterministic repository tests using a fake gateway plus offline/online browser smoke.
  - Files: new `src/` persistence modules, `src/storage.ts`, test files, `package.json` scripts.

- [ ] **Migrate current local history by explicit user choice**
  - Acceptance: first authenticated use presents a migration choice; accepting transfers each legacy script once; declining keeps scripts local; rerunning migration creates no duplicates.
  - Verify: seed legacy local history, execute accept/decline/retry flows.
  - Files: library/repository UI and migration modules.

## 4. Script library

- [ ] **Replace recent history with the responsive script library**
  - Acceptance: users can search title/preview, open a script, view metadata/source, favorite/unfavorite, set one tag, rename, duplicate, and delete with confirmation using keyboard and pointer.
  - Verify: browser walkthrough with at least 20 scripts in desktop and narrow mobile layout.
  - Files: `app/index.html`, `src/elements.ts`, `src/render.ts`, `src/main.ts`, `src/types.ts`.

- [ ] **Bind editing and Google Docs import to stable script IDs**
  - Acceptance: editing/importing an opened script updates that one record without duplicate creation and preserves its non-edited metadata.
  - Verify: open → edit → save → reload; import/refresh a Google Doc-backed script and confirm source metadata remains.
  - Files: `src/main.ts`, repository modules, `src/gdoc.ts` only if required.

## 5. Prompter session UX

- [ ] **Add speakable-word progress and mode-aware time estimate**
  - Acceptance: HUD counts only non-skipped words; constant/sound modes show remaining estimate; voice mode is clearly indeterminate; zero-speakable scripts are safe.
  - Verify: unit tests for count/estimate helpers; desktop/mobile browser smoke.
  - Files: `app/index.html`, `src/elements.ts`, `src/render.ts`, `src/main.ts`.

- [ ] **Add paragraph navigation without layout regressions**
  - Acceptance: previous/next paragraph controls and restart operate via existing navigation primitives; no controls obstruct words/camera/dock in video, portrait, or landscape iOS layouts.
  - Verify: browser checks in regular, split video, overlay video, narrow portrait, and landscape.
  - Files: `app/index.html`, `src/elements.ts`, `src/main.ts`, `src/render.ts`.

## 6. Voice tracking

- [ ] **Extract and test deterministic token matching**
  - Acceptance: normalizer/candidate matcher is pure and covers punctuation, Unicode case, repeated/common words, ad-lib noise, cues, command phrases, and bounded recovery.
  - Verify: focused test command added to `package.json` passes.
  - Files: new matching module, `src/speech.ts`, test files, `package.json`.

- [ ] **Expose conservative tracking sensitivity**
  - Acceptance: settings present conservative/standard/forgiving choices; default avoids weak one-token jumps; current voice-command and recognition lifecycle behavior remain intact.
  - Verify: unit suite and browser microphone smoke with altered phrases.
  - Files: `app/index.html`, `src/elements.ts`, `src/state.ts`, `src/types.ts`, `src/main.ts`, `src/speech.ts`.

## 7. Documentation, release, and live verification

- [ ] **Update privacy and sync documentation**
  - Acceptance: README accurately explains optional Google-signed-in sync, private backend design, offline availability, and that recognition audio stays local.
  - Verify: doc review against deployed behavior.
  - Files: `README.md`, plus limited app copy only if required.

- [ ] **Build, deploy, and verify the live upgrade**
  - Acceptance: `npm run build` succeeds; the real `tele.alphasync.dev/app/` target serves the update; full signed-in/offline/library/session/voice journey works; backend remains private.
  - Verify: build output, deployed browser walkthrough, cross-user isolation check, and public-route inspection.
  - Files: deploy workflow/config only if a concrete issue is found.
