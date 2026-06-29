# Handoff: reusing Plannotator's document UI in Workspaces

This document is for the team building the commercial **Workspaces** app. It explains what this PR shipped, how the published packages are put together, and exactly how Workspaces plugs its own backend (storage, auth, realtime, AI) into the same document UI that Plannotator uses — without forking or rebuilding it.

If you read nothing else, read **"The 60-second version"** and **"The seam catalog"**.

---

## The 60-second version

- Plannotator's document UI (markdown rendering, theme, the annotation editor, settings, comments, file browser, plan diff, layout) is now two installable npm packages: **`@plannotator/ui`** (React components + hooks + theme) and **`@plannotator/core`** (pure utils + types, zero dependencies, browser-safe).
- Workspaces installs both, imports the components it wants, imports one stylesheet, loads fonts, and calls **`configurePlannotatorUI({ ... })` once at startup** to plug in its own backend.
- Every place the UI talks to a backend is an **optional seam**. Each seam has a default that reproduces today's Plannotator behavior (hitting `/api/*` over fetch). If Workspaces passes its own implementation, the UI uses that instead. If it passes nothing, it behaves like Plannotator.
- Plannotator itself is **unchanged** — it passes nothing and keeps using the defaults. This is the core constraint the whole design protects (see "The law").

---

## What this PR changed (inventory)

**New package: `@plannotator/core`** — a browser-safe, zero-dependency package carved out of `@plannotator/shared`. It holds the pure utilities and types `ui` depends on, so `ui` can be installed without dragging in Plannotator's Node/server code. Modules were moved with `git mv` (not copied). CI typechecks it with no `@types/node` so a `node:` import can't sneak in.

Core modules: `agents`, `agent-jobs`, `agent-terminal`, `browser-paths`, `code-file`, `compress`, `crypto`, `external-annotation`, `extract-code-paths`, `favicon`, `feedback-templates`, `goal-setup`, `open-in-apps`, `project`, `source-save`, plus extracted type files (`config-types`, `storage-types`, `workspace-status-types`, `ai-context`, `types`).

**`@plannotator/shared` re-exports core via one-line shims** — e.g. `packages/shared/project.ts` is just `export * from '@plannotator/core/project';`. This is why none of Plannotator's ~99 internal import sites changed: they still import from `@plannotator/shared/*` and get the moved code transparently.

**`@plannotator/ui` got the host-override seams** (the bulk of the diff) plus:
- `configure.ts` — the single front door, `configurePlannotatorUI()`.
- Each seam file gained a `setX`/`resetX` (or `get`) accessor and a default implementation.
- `*.seam.test.tsx` files — tests proving each seam defaults to Plannotator behavior and routes to a host override when set.
- Precompiled `styles.css` (185KB) built from `styles-entry.css` via `vite.css.config.ts`, so a consumer doesn't have to wire Tailwind to use the theme. Font binaries are **not** bundled (the consuming app owns fonts).
- `wideMode.ts` moved from `packages/editor` into `ui/utils` (it was UI-layer state).

Net: `159 files changed, +7342 / −2723`. Most of the deletions are the `git mv` of core modules out of `shared`; most of the additions are seams + tests + the moved core package.

---

## Architecture: three packages, one rule

```
@plannotator/core   ← pure utils + types. zero deps. browser-safe (no node:). PUBLISHED.
       ↑
@plannotator/ui     ← React components + hooks + theme + configure(). PUBLISHED.
                       depends on core (exact-version lockstep).
       ↑
@plannotator/shared ← Node/git/server logic. PRIVATE to the monorepo.
                       re-exports core's moved modules via shims so Plannotator is untouched.
```

- **Workspaces installs `@plannotator/ui` + `@plannotator/core`.** It never touches `shared` (that's Plannotator's server-side code).
- **No circular dependencies by construction**: `core` imports nothing, `ui` imports `core`, `shared` imports `core`. One direction only.
- **The packages ship TypeScript source, not compiled JS.** Workspaces' bundler compiles them (it's an internal consumer, and this keeps source-mapping and tree-shaking clean). That means Workspaces needs a TS/TSX-capable bundler — Vite + React 19 + Tailwind v4, with `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `jsx: "react-jsx"`.

### The seam pattern (how an override works)

Each seam is a module-level variable holding the current implementation, defaulting to Plannotator's behavior, with a setter:

```ts
// utils/storage.ts (representative)
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const cookieBackend: StorageBackend = { /* Plannotator's cookie reads/writes */ };
let backend: StorageBackend = cookieBackend;            // ← the default IS today's behavior

export function setStorageBackend(b: StorageBackend) { backend = b; }   // ← host override
export function resetStorageBackend() { backend = cookieBackend; }      // ← tests restore default
```

Everything in the UI reads through `backend`. Plannotator never calls the setter, so it stays on cookies. Workspaces calls `setStorageBackend(itsOwnBackend)` once at startup (via `configurePlannotatorUI`) and the whole UI persists settings to Workspaces' store instead.

**A note on this being module-level (a "singleton") and not a React Provider:** this is intentional and safe *for a client-side app*. Each user's browser runs its own copy of these variables; there's one logged-in user per browser; nothing is shared across users. The only setup where a module-level global is wrong is **server-side rendering** — one server process rendering for many concurrent users would let one user's render read another's identity. **Workspaces does not do SSR**, so this is a non-issue. If Workspaces ever adds SSR for this UI, that's the moment to revisit (the fix would be a React `<PlannotatorUIServices>` provider, and `configurePlannotatorUI` would become a thin compatibility shim over it). Until then, don't add that complexity.

---

## The seam catalog

Pass any subset of these to `configurePlannotatorUI({ ... })`. Anything omitted keeps Plannotator's default. The interfaces below are the real contracts as shipped.

| Seam (config key) | Type | What it controls | Default behavior |
|---|---|---|---|
| `storageBackend` | `StorageBackend` | Where UI settings persist (identity, plan-save prefs, toggles) | Cookies |
| `identityProvider` | `IdentityProvider` | Who the current user is — stamps `author`, drives the `(me)` badge, and (via `isEditable()`) whether the Settings rename controls show | Reads `displayName` from ConfigStore (server > cookie > generated "tater" name); editable |
| `imageSrcResolver` | `(path, base?) => string` | Turns a stored image path/ref into a URL the browser can load | `/api/image?path=…` (http(s) URLs pass through unchanged) |
| `uploadTransport` | `UploadTransport` | Where pasted/attached images upload to | `POST /api/upload` (multipart), returns `{ path }` |
| `docPreviewFetcher` | `(path, base?) => Promise<DocPreviewResult \| null>` | Hover/inline preview of a linked `.md` doc | `GET /api/doc` |
| `fileTreeBackend` | `FileTreeBackend` | The file/folder browser tree + live-watch | `GET /api/reference/files`, EventSource watch |
| `draftTransport` | `DraftTransport` | Auto-saved annotation drafts (survive a crash/reload) | `GET/POST/DELETE /api/draft` |
| `externalAnnotationTransport` | `ExternalAnnotationTransport<T>` | Live/agent comments streamed into the doc | SSE `/api/external-annotations/stream` + polling snapshot + CRUD |
| `aiTransport` | `AITransport` | The "Ask AI" chat session/query/abort/permission | `POST /api/ai/{session,query,abort,permission}` |
| `serverSync` | `ServerSyncFn` | Push a settings change back to the server | No-op-ish (Plannotator's local sync) |
| `loadSettingsFromBackend` | `boolean` | After install, re-hydrate settings from your `storageBackend` | off |

### Interface details worth knowing

**`StorageBackend`** — must be **synchronous** (`getItem`/`setItem`/`removeItem` return immediately). If Workspaces' real store is async (KV, D1, a Durable Object), back this with an in-memory cache that you hydrate before mounting the UI, and write through asynchronously. That's also what `loadSettingsFromBackend: true` is for — it re-reads settings from your backend right after install, once it's in place.

**`IdentityProvider`** — `getIdentity(): string` (display name), `isCurrentUser(author): boolean`, and optional `isEditable(): boolean` (default editable). For Workspaces this is your auth'd user. **Return `isEditable() => false`** for logged-in users: Workspaces stamps the author from the server-side account id and users can't rename themselves, so the UI must hide its rename/regenerate controls — otherwise a locally-chosen name diverges from the server-stamped author (the "split author" hazard). Two things to know from the Workspaces side: (1) the current `Me` projection (`GET /v1/me`) carries only `user_id` + `email` — **no display name** — so until the backend adds a name field, `getIdentity()` can only return the email or id; (2) free-text author names *are* accepted for anonymous commenters on open docs, so `isEditable()` may return `true` for that branch.

**`UploadTransport`** — `upload(file: File): Promise<{ path: string; originalName? }>`. The default does Plannotator's `POST /api/upload` and returns the server path. For Workspaces, send the bytes to your asset API (`PUT /v1/workspaces/:wsId/assets/:assetPath`) and return the content-addressed URL (or an opaque ref) in `path`. Notes from the Workspaces asset layer: your API makes the **caller choose the asset path** and 409s if a document owns it, so your adapter — not the UI — owns path selection (namespace uploads, e.g. an `assets/` prefix); it enforces a **10 MiB cap + content-type allowlist**, so surface upload failures; and because asset URLs need **no signing** (content-addressed, served from the cookieless `tot.page` origin), `imageSrcResolver` can be a pass-through — returning a full URL in `path` renders directly (the default resolver passes http(s) URLs through).

**`DraftTransport`** — `load()`, `save(body, { keepalive })`, `remove(generation, { keepalive })`. The generation-gated tombstone and keepalive retry logic stay inside the hook; you only provide the three transport calls. `keepalive: true` means "best-effort deliver this even though the page is closing" (maps to `fetch(..., { keepalive: true })` or `navigator.sendBeacon`).

**`ExternalAnnotationTransport<T>`** — `subscribe(onEvent, onError) => unsubscribe`, `getSnapshot(since) => { annotations, version } | null` (return `null` for "no changes", i.e. the 304 case), plus `add/remove/update/clear`. For Workspaces this is your realtime layer — a Durable Object WebSocket or SSE fanning out comment events. `T` extends `{ id: string; source?: string }`; if your annotation type adds fields, call `setExternalAnnotationTransport<YourType>()` directly for full type safety (the `configure` front door pins the base type for ergonomics).

**`AITransport`** and **`FileTreeBackend`** currently return `Response` objects** (the raw `fetch` response) rather than parsed domain types — `session/query` return `Promise<Response>`, `loadTree/loadVaultTree` return `Promise<Response>` whose JSON is a known shape. **This is a known rough edge** (see "Known rough edges"). To satisfy these today, Workspaces has to hand back something `Response`-shaped (status, `.json()`, and for `query`, an SSE body stream). It works, but it leaks the old HTTP contract. We deliberately left it as-is for the first cut (move-don't-rewrite); expect to clean it up in a v2 driven by what's actually painful when you wire it.

---

## How Workspaces consumes it

```bash
npm install @plannotator/ui @plannotator/core
```

```ts
// app entry, once at startup
import { configurePlannotatorUI } from "@plannotator/ui/configure";
import "@plannotator/ui/styles.css";

// load fonts (the stylesheet references --font-sans / --font-mono but ships no binaries)
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
// …or provide your own fonts and set --font-sans / --font-mono to match.

configurePlannotatorUI({
  storageBackend,                 // your settings store (localStorage is already sync)
  identityProvider,               // your auth'd user (isEditable:false for logged-in users)
  imageSrcResolver,               // your asset URL scheme (pass-through for content-addressed URLs)
  uploadTransport,                // upload pasted images to your R2 asset API
  docPreviewFetcher,              // your doc store
  fileTreeBackend,                // your workspace file tree + realtime watch
  draftTransport,                 // your draft store
  externalAnnotationTransport,    // adapt your Yjs/WebSocket realtime onto this
  // aiTransport,                 // omit — Workspaces has no AI backend yet (stays default/off)
  serverSync,                     // your settings push
  loadSettingsFromBackend: true,  // re-hydrate settings from storageBackend after install
});
```

```ts
// then render the components you want
import { Viewer } from "@plannotator/ui/components/Viewer";
```

A few component-specific behaviors (e.g. an "open this diff in the editor" action) are passed as **props** at the render site rather than through `configure` — those are local to one component, not app-global.

### Mapping the seams to Workspaces' actual stack

Grounded in a read of the Workspaces repo (`apps/app`, `apps/usercontent`, `apps/web`, the DocumentDO). The web app doesn't import this UI yet, so this is the greenfield wiring plan.

| Seam | Workspaces backing | Effort |
|---|---|---|
| `storageBackend` | `window.localStorage` — already synchronous, matches the seam as-is. (Server-syncing prefs later is optional; not needed for the seam.) | trivial |
| `identityProvider` | Read the already-hydrated `me` from `SessionContext` (`GET /v1/me`). `getIdentity()` returns email/id (no name field yet), `isCurrentUser(a) = a === me.user_id`, `isEditable() => false` for logged-in users. | thin adapter |
| `imageSrcResolver` | Pass-through — asset URLs are content-addressed and need no signing. | trivial |
| `uploadTransport` | `PUT /v1/workspaces/:wsId/assets/:assetPath` → R2 (`AssetBytes` interface). Adapter owns asset-path selection. | new adapter |
| `docPreviewFetcher` | `GET /v1/workspaces/:wsId/documents/:docId` (D1 + git content store). | thin adapter |
| `fileTreeBackend` | `GET /v1/workspaces/:wsId/documents` (D1 doc list); live-watch via the DocumentDO. | thin adapter |
| `draftTransport` | KV or a per-doc Durable Object; `sendBeacon` for keepalive. | thin adapter |
| `externalAnnotationTransport` | **Transport kind differs** — Workspaces realtime is Yjs-over-WebSocket (DocumentDO), and comments are REST with no live push. Adapt comment events onto the DO awareness channel (or add an SSE endpoint). | biggest adapter |
| `aiTransport` | **No AI backend exists** in Workspaces. Leave at default/off until one is built. | new infra (later) |
| `serverSync` | A Worker endpoint that persists the settings delta. | thin adapter |

**Backend follow-up (Workspaces side, not a UI change):** if you want readable author names instead of raw `user_…` ids in comments, the `Me`/annotation projections need to start carrying a display-name field (WorkOS has `first_name`/`last_name`; the current `Me` projection drops them).

---

## Known rough edges (and why they're fine for now)

1. **`AITransport` / `FileTreeBackend` leak `Response`.** They return raw fetch `Response` objects instead of clean domain types (`{ sessionId }`, `AsyncIterable<AIMessage>`, `{ tree, workspaceStatus }`). A reviewer correctly flagged this. We kept it deliberately: the goal of this PR was **move-don't-rewrite**, and reshaping these contracts is exactly the kind of redesign that's better driven by the real consumer (Workspaces) once you feel the pain. Plan a v2 pass on these two once you've wired them.

2. **`InlineMarkdown.tsx` is large (~1k lines)** and now hosts the `docPreviewFetcher` seam inline. Cheap future cleanup: extract the doc-preview seam into its own module so the renderer shrinks. Not blocking.

3. **Module-level singletons, not a Provider.** Covered above — safe because Workspaces is client-side, not SSR. Only revisit if SSR is added.

None of these block adoption. They're the honest "here's what we'd polish next" list.

---

## Publishing & versioning

- `@plannotator/core` and `@plannotator/ui` are versioned **in lockstep with the repo** (currently `0.21.3`).
- They depend on each other via `workspace:*`. At publish time that must resolve to the **exact** version in the tarball, so publish with a tool that does that resolution (the repo's existing flow uses `bun pm pack` to build the tarball, then `npm publish *.tgz --provenance --access public`). Publish **`core` first, then `ui`**.
- `styles.css` is built by the `prepack` script (`bun run build:css`) so the published tarball always carries fresh precompiled CSS.
- There is **no CI publish job for these two packages yet** — first publish is manual from `main` after merge. (Wiring a CI publish job is a follow-up.)

---

## The law (guardrails for anyone editing `@plannotator/ui`)

These are enforced socially and, where possible, by CI. They exist because a prior from-scratch reimplementation of this UI broke the app and was reverted.

1. **Don't reimplement the document UI from scratch.** Add a seam; don't rebuild.
2. **Every seam's default must reproduce today's Plannotator behavior.** Plannotator passes nothing and stays byte-for-byte unchanged.
3. **`@plannotator/core` is browser-safe and zero-dep — no `node:` imports.** CI enforces it.
4. **Never delete working Plannotator code until a human confirms parity in the browser.**

See `packages/ui/README.md` and `packages/ui/AGENTS.md` (CLAUDE.md symlink) for the short version that lives next to the code.
