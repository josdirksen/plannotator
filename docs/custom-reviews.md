# Custom Reviews

Status: design reference, not yet implemented.

Custom reviews let a developer run a named review — "Security", "Performance",
"API Contract" — through the existing Claude and Codex background review
pipeline, instead of only the default review.

This doc is the authoritative spec. It is deliberately small. The companion
`agent-jobs-code-review-handoff.md` describes the current code this builds on;
read it first if you are new to the review pipeline.

## What this is

A review profile is a named bundle of review intent. You drop a JSON file in a
folder, it shows up in the review picker, you pick it, findings come back the
same way they do today.

```json
{ "instructions": "Focus only on security-impacting issues." }
```

That is a complete, valid profile.

## Design rules

Two rules keep this simple:

1. **Zero-config by default.** A user who never makes a profile gets the full
   Default review, exactly as today. The picker adds one dropdown, nothing more.
2. **Minimal input.** Authoring a profile means writing intent, not filling out
   a schema. Anything we can infer (`id`, `label`, `engines`) we infer.

The user only ever thinks about three things: which engine, which review, and
the review's intent. Schemas, provider output formats, job protocols, and
annotation plumbing stay invisible. When a tidy internal contract and a simpler
user experience conflict, the user experience wins — absorb the cost in the
backend.

This is a tool for open-source developers, not an enterprise config system.
There is no governance layer (see [Deliberately not building](#deliberately-not-building)).

## Data model

```ts
export interface ReviewProfile {
  id: string;            // inferred from filename if omitted
  label: string;         // inferred from id if omitted
  instructions: string;  // the only field a human must write
  description?: string;
  engines?: Array<"claude" | "codex">; // defaults to all engines
}

export interface ResolvedReviewProfile extends ReviewProfile {
  source: "builtin" | "user" | "repo";
  sourcePath?: string;
}
```

`instructions` is the reviewer focus. It is inserted into a bounded section of
the provider prompt — it does not replace the provider's system or output-format
instructions.

No content hashing, no version tracking. The job stores the profile's `label`
and `source`; that is enough to answer "which review produced these findings?"

## Where profiles live

Three sources, loaded in this order:

| Source | Location | Notes |
| --- | --- | --- |
| `builtin` | in code | `builtin:default` is today's review, preserved. |
| `user` | `${PLANNOTATOR_DATA_DIR}/reviews/*.json` | personal, available in every repo |
| `repo` | `.plannotator/reviews/*.json` | checked in, shared with the team |

Use the existing Plannotator data-dir abstraction for the user path. Do not
hardcode `~/.plannotator` — the data dir is overridable.

### Inference

For user and repo profiles, the loader fills in what the file omits:

- `id` ← filename stem, namespaced by source: `security.json` → `user:security`
  or `repo:security`.
- `label` ← title-cased id: `api-contracts` → `API Contracts`.
- `engines` ← all supported engines.

Inference runs once at load time. The rest of the system only ever sees a
fully-resolved profile.

### Name clashes

Kept trivial on purpose:

- `builtin:default` is special-cased and always wins its name.
- If a user and a repo profile resolve to the same bare name, the user one wins.
- A malformed JSON file is skipped, with one log line. It does not break
  discovery.

That is the whole collision story. No reserved-ID engine, no precedence
framework — a sort and a `Map`.

### Repo profiles

A repo profile is just instructions handed to a CLI the developer already runs
inside that repo. It escalates nothing the agent could not already do. The only
thing worth surfacing is provenance: mark repo-sourced profiles with a small
`repo` tag in the picker so the user knows where the option came from.

## Discovery

```txt
GET /api/agents/review-profiles
```

Returns the resolved, launchable profiles:

```ts
export interface ReviewProfilesResponse {
  profiles: Array<{
    id: string;
    label: string;
    description?: string;
    engines: Array<"claude" | "codex">;
    source: "builtin" | "user" | "repo";
    sourcePath?: string;
    default?: boolean;
  }>;
}
```

Reload on each request. No file watching.

## Launching

Reuse the existing job launch endpoint. Add one field.

```txt
POST /api/agents/jobs
```

```ts
export interface LaunchAgentJobRequest {
  provider: "claude" | "codex" | "tour";
  reviewProfileId?: string;   // absent → builtin:default
  model?: string;
  effort?: string;
  reasoningEffort?: string;
  fastMode?: boolean;
}
```

Today the Bun and Pi adapters forward only
`{ engine?, model?, reasoningEffort?, effort?, fastMode? }` into `buildCommand`.
Widen both to also parse and forward `reviewProfileId`, and reject unknown
fields rather than ignoring them. Do **not** add an inline `reviewPrompt` — the
launch API takes a profile id, never freeform prompt text.

### Job metadata

Add two fields to `AgentJobInfo` (`packages/shared/agent-jobs.ts`, vendored to
Pi):

```ts
reviewProfileId?: string;
reviewProfileLabel?: string;
```

These give the job detail panel, logs, and exported markdown a stable answer to
"which review profile ran?" `reviewProfileLabel` also rides on each annotation
so the UI can show a small profile tag.

## Launch-time resolution

Resolve the profile at the same boundary where `review.ts`'s `buildCommand`
already snapshots launch state (patch, diff type, base, PR metadata, diff scope,
workspace, cwd). Resolving there means a repo profile is read against the same
target the agent will actually review.

Repo-profile scoping, simplest safe version:

- Built-in and user profiles: available everywhere.
- Repo profiles: available only when there is one unambiguous local review repo.
  In remote-only PR mode and ambiguous workspace mode, repo profiles are simply
  absent from the picker.

## Prompt composition

Deterministic and sectioned. Custom instructions never displace provider
instructions.

```txt
<provider immutable review system prompt>

<provider immutable output-format instructions>

## Custom Review Profile

Profile: <label>
Source: <builtin|user|repo>

<profile.instructions>

---

<existing buildAgentReviewUserMessage(...) output>
```

For `builtin:default`, the Custom Review Profile section is omitted entirely, so
the default prompt is byte-for-byte today's prompt.

## Findings

Both engines already parse into review findings and transform them into external
annotations. Custom reviews change two things.

### One severity scale

A user should see the same severity badges regardless of engine. Normalize to
the shared `important | nit | pre_existing` scale:

- Claude already emits this scale.
- Codex emits `priority` 0–3 (or null). Map on ingest, e.g. `0,1 → important`,
  `2 → nit`, `3/null → pre_existing`. Keep the map in one place so the UI never
  has to know which engine ran.

### Author and profile

Keep `author` as the engine name (`Claude Code`, `Codex`) so the byline stays
short. Carry the profile as `reviewProfileLabel` metadata and render it as a
small tag next to the byline — do not concatenate it into the author string.

> Note: `transformClaudeFindings` hardcodes `author: "Claude Code"`, while
> `transformReviewFindings` (Codex) already takes an author argument. Carrying
> the profile as metadata sidesteps a signature change on the Claude transform.

### Keep findings honest to the diff

Today findings flow straight from transform to `externalAnnotations.addAnnotations`
with only shape validation. Add one cheap guard in `onJobComplete`, before
ingestion: drop any finding whose file is not in the launch patch, and count how
many were dropped.

This is a ~15-line filter, not a module. No path-escape analysis, no rename
normalization, no hunk-level validation. If every finding is dropped, fail the
job (see below). Otherwise ingest the survivors and, if any were dropped,
surface a calm one-liner:

```txt
8 findings · 2 skipped (not in the reviewed diff)
```

Never expose schema or provider internals in that message.

## Completion semantics

Process success is not review success. Follow the Code Tour precedent already in
the codebase:

- Process exits non-zero → job fails (today's behavior).
- Output missing or unparseable → job fails.
- Every finding dropped as out-of-diff → job fails.
- Otherwise the job completes, and `job:completed` reflects the post-ingestion
  state.

A profile cannot turn a broken run into a green "0 findings."

## Runtime parity

Bun and Pi must behave the same. The launch contract, discovery endpoint, job
metadata, and completion semantics all need to land in both:

- `packages/server/review.ts` ↔ `apps/pi-extension/server/serverReview.ts`
- `packages/server/agent-jobs.ts` ↔ `apps/pi-extension/server/agent-jobs.ts`

New shared/server modules must be added to `apps/pi-extension/vendor.sh`. Every
new module is paid twice (source + vendored copy), which is the main reason this
design keeps the module count low.

## Modules

Two new files. Everything else is small edits.

```txt
packages/shared/review-profiles.ts
  Types, shape validation, id-from-filename inference, name-clash resolution.
  Runtime-agnostic → vendored to Pi.

packages/server/review-profile-loader.ts
  Read built-in + user dir + repo dir, apply inference, return a flat list.
```

Edits:

```txt
packages/shared/agent-jobs.ts          + reviewProfileId / reviewProfileLabel
packages/server/agent-jobs.ts          parse + forward reviewProfileId
apps/pi-extension/server/agent-jobs.ts mirror
packages/server/review.ts              discovery route, launch-time resolution,
                                       prompt composition, in-diff filter,
                                       completion semantics, severity map
apps/pi-extension/server/serverReview.ts  mirror
packages/server/claude-review.ts       prompt composition slot
packages/server/codex-review.ts        prompt composition slot, priority→severity
apps/pi-extension/vendor.sh            add the new shared module
```

## Build order

Backend only. The feature is fully drivable over HTTP — no UI required to test.
The existing "Run Review" button keeps working throughout, because no
`reviewProfileId` means `builtin:default`.

1. Shared profile types + validation + inference.
2. Profile loader + `GET /api/agents/review-profiles`.
3. `reviewProfileId` parsing/forwarding in Bun and Pi adapters; job metadata.
4. Launch-time resolution in `review.ts`.
5. Prompt composition.
6. Severity normalization.
7. In-diff filter + completion semantics.

Then, separately, the frontend (deferred): the engine/review picker in
`AgentsTab.tsx`, sending `reviewProfileId` from `useAgentJobs.ts`, the repo tag,
and the profile tag on annotations.

## Tests

Keep them proportional:

- Inference: `security.json` → `user:security`, label title-casing.
- Name clash: user beats repo; malformed file is skipped, not fatal.
- Launch: `POST /api/agents/jobs` forwards `reviewProfileId`, rejects unknown
  fields, defaults to `builtin:default` when absent.
- Prompt: custom section present for a profile, absent for default.
- Severity: Codex priority maps to the shared scale.
- Findings: out-of-diff finding is dropped; all-dropped fails the job.
- Bun/Pi launch contracts stay compatible.

One happy path and one failure path end to end:

```txt
repo profile → launch Codex → parse → in-diff findings → annotations appear
repo profile → provider exits 0 with junk → job fails → no annotations
```

## Deliberately not building

Recorded so these stay cut, not silently reintroduced:

- No precedence engine, reserved-ID system, or shadow-prevention rules. A sort
  and a `Map`.
- No content hashing / profile version tracking.
- No structured discovery `diagnostics[]` channel. Skip-and-log.
- No `ReviewEngineAdapter` interface or formal `NormalizedReviewResult` boundary.
  The two transforms returning a shared finding shape is enough.
- No diff-anchoring module. A one-function in-diff filter.
- No inline `reviewPrompt` in the launch API.
- No temporary one-off profile workflow. If it's ever wanted, it's a thin layer
  that writes a user profile and launches by id — not part of this design.

If one of these turns out to be genuinely needed, add it then, on evidence — not
preemptively.
