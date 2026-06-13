# Agent Jobs and Automated Code Review Handoff

Last verified against the worktree on 2026-06-13.

This document is a map for coding agents that need to modify or debug
Plannotator's automated code review features. It covers:

- The code review command path.
- Background agent jobs for Claude, Codex, and Code Tour.
- The programmatic protocols used to run Claude and Codex.
- Programmatic creation of annotations over diffs.
- The Ask AI provider layer, which is separate from background review jobs.
- The Bun server and Pi server mirror points that must stay in parity.

## Mental Model

Plannotator has two distinct AI systems in code review mode.

1. Background review agents:
   - Launched from the Review Agents sidebar.
   - Exposed over `/api/agents/*`.
   - Spawn external CLI processes (`claude`, `codex`) and track them as jobs.
   - Code review jobs emit findings as external diff annotations.
   - Code Tour jobs emit a structured tour artifact and do not emit annotations.

2. Ask AI:
   - Launched from inline diff/UI questions.
   - Exposed over `/api/ai/*`.
   - Uses provider sessions from `@plannotator/ai`.
   - Streams normalized `AIMessage` events.
   - Does not create review annotations by itself.

Keep these separate. They share diff context and UI surfaces, but their
protocols, state stores, and result ingestion paths are different.

## Code Review Entry Flow

The host-facing command is `plannotator review [optional-pr-url]`.

1. Agent skills or command wrappers invoke `plannotator review`.
2. `apps/hook/server/index.ts` parses review args.
3. It captures one of:
   - local Git/JJ diff,
   - nested workspace diff,
   - remote PR/MR patch,
   - PR/MR patch plus an optional local checkout for file access.
4. It starts `startReviewServer()` from `packages/server/review.ts`.
5. The browser review UI loads the review-editor bundle.
6. The user or a background agent creates annotations.
7. The UI posts `/api/feedback`.
8. The server resolves `waitForDecision()`.
9. The CLI prints feedback or approval text to stdout for the host agent.

OpenCode has an internal bridge (`opencode-review`) that returns structured
JSON instead of plain stdout, but it still starts the same review server.

Codex manual code review uses the same CLI command from a Codex shell bang:

```bash
!plannotator review
```

## Background Agent Job Protocol

Shared contract: `packages/shared/agent-jobs.ts`.

State:

- `AgentJobStatus`: `starting`, `running`, `done`, `failed`, `killed`.
- `AgentJobInfo`: job id, source id, provider, label, status, timestamps,
  command, cwd, prompt, summary, PR attribution, model/effort metadata, and
  launch-time diff context.
- `jobSource(id)`: creates the source string `agent-<first-8-id-chars>`.
  This source is used to group annotations produced by the job.

HTTP endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/agents/capabilities` | GET | Returns available providers. |
| `/api/agents/jobs/stream` | GET | SSE stream. Sends an initial snapshot and later job/log events. |
| `/api/agents/jobs?since=N` | GET | Polling fallback, 304 when version is unchanged. |
| `/api/agents/jobs` | POST | Launch a job. |
| `/api/agents/jobs/:id` | DELETE | Kill one job. |
| `/api/agents/jobs` | DELETE | Kill all running jobs. |

SSE events:

- `snapshot`
- `job:started`
- `job:updated`
- `job:completed`
- `job:log`
- `jobs:cleared` (currently a no-op on the UI side because kill-all emits
  per-job completion events)

Transport behavior:

- SSE sends a heartbeat comment every 30 seconds.
- UI falls back to 500 ms polling if it never receives a stream snapshot.
- All job state is in memory and scoped to the review server lifetime.

Spawn behavior:

- The server builds commands for known providers. The UI sends provider and
  configuration, not trusted argv.
- Spawned processes receive:
  - `PLANNOTATOR_AGENT_SOURCE=<job source>`
  - `PLANNOTATOR_API_URL=<review server base url>`
- These env vars let external tools post their own annotations with the same
  source identity, although built-in Claude/Codex jobs ingest results directly
  server-side.
- Result ingestion runs before `job:completed` is broadcast, so annotations
  should reach the UI before the job card switches to a terminal state.
- Server shutdown calls `killAll()`.

Capability detection:

- `claude`: available when `claude` is on PATH.
- `codex`: available when `codex` is on PATH.
- `tour`: available when either `claude` or `codex` is on PATH.

## Review Server Agent Launch Rules

Main implementation: `packages/server/review.ts`.

On agent launch, the server snapshots mutable review state before awaits:

- current patch,
- current diff type,
- selected base,
- PR metadata,
- PR diff scope,
- workspace context,
- launch cwd.

This matters because PR switches, diff switches, base switches, and checkout
warmups can happen while a job is launching. The stored job metadata must match
the diff the agent actually reviewed, not the diff currently displayed after a
later UI action.

Launch cwd rules:

- Workspace review: use workspace root.
- Local VCS review: resolve cwd from the active diff/worktree.
- PR review with local checkout: wait for checkout before launching jobs that
  claim local file access.
- If a PR checkout cannot be produced, agent launch returns a 503 instead of
  running in the wrong directory.

Diff context rules:

- Local and workspace jobs store `diffContext` on `AgentJobInfo`.
- PR jobs store PR URL and PR diff scope instead.
- The job detail panel uses the job's launch-time diff context for "Copy All",
  not the UI's current diff context.

## Programmatic Claude Code Review

Implementation: `packages/server/claude-review.ts`.

Claude uses a severity-oriented review schema:

- `important`
- `nit`
- `pre_existing`

Command shape:

```text
claude -p
  --permission-mode dontAsk
  --output-format stream-json
  --verbose
  --json-schema <inline schema>
  --no-session-persistence
  --model <model>
  [--effort <effort>]
  --tools Agent,Bash,Read,Glob,Grep
  --allowedTools <read-only allowlist>
  --disallowedTools <write/network/shell denylist>
```

Protocol details:

- The review prompt is written to stdin, not passed as an argv argument.
- stdout is captured because final structured output arrives in stream JSON.
- stderr is captured for error tail and streamed as live logs.
- stdout JSONL lines are formatted into readable live logs with
  `formatClaudeLogEvent()`.
- The final result is the last `type: "result"` event with
  `structured_output`.
- `parseClaudeStreamOutput()` returns null on errors or malformed output.

Result transform:

- `transformClaudeFindings()` converts findings into review annotations.
- Paths are made relative to cwd.
- Workspace mode can apply `workspace.normalizeAnnotationPath()`.
- The annotation author is `Claude Code`.
- `text` is prefixed with `[severity]`.
- `severity` and `reasoning` are preserved on the annotation.
- Side is always `new`, scope is `line`, type is `comment`.

Summary:

- `important == 0` means `Correct`.
- Any important finding means `Issues Found`.
- Confidence is derived from important finding count.

UI defaults:

- `packages/ui/hooks/useAgentSettings.ts` defaults review Claude to
  `claude-opus-4-7` with effort `high`.
- The server command builder also has a fallback model, but the UI normally
  sends explicit settings.

## Programmatic Codex Code Review

Implementation: `packages/server/codex-review.ts`.

Codex uses a priority-oriented schema modeled on Codex review output:

- `priority`: 0, 1, 2, 3, or null.
- `code_location.absolute_file_path`
- `code_location.line_range.start/end`
- `overall_correctness`
- `overall_explanation`
- `overall_confidence_score`

Command shape:

```text
codex
  [-m <model>]
  [-c model_reasoning_effort=<effort>]
  [-c service_tier=fast]
  exec
  --output-schema <materialized schema path>
  -o <temp output path>
  --full-auto
  --ephemeral
  -C <cwd>
  <prompt>
```

Protocol details:

- The output schema is materialized under the Plannotator data dir because the
  compiled Bun binary virtual filesystem is not readable by external processes.
- The prompt is passed as the final argv item.
- Structured output is written to the `-o` file.
- `parseCodexOutput()` reads and deletes the temp output file.
- Debug logging goes to `codex-review-debug.log` only when
  `PLANNOTATOR_DEBUG` is set.

Result transform:

- `transformReviewFindings()` converts Codex findings into review annotations.
- Paths are made relative to cwd.
- Workspace mode can apply `workspace.normalizeAnnotationPath()`.
- The annotation author is `Codex`.
- `text` is `title` plus `body`.
- Side is always `new`, scope is `line`, type is `comment`.

Summary:

- If any P0/P1 finding exists, Plannotator overrides the freeform correctness
  with `Issues Found`.
- Otherwise it uses Codex's overall correctness/explanation/confidence.

UI defaults:

- `packages/ui/hooks/useAgentSettings.ts` defaults review Codex to
  `gpt-5.3-codex`, reasoning `high`, fast mode off.

## Prompt Construction for Review Jobs

Shared prompt-target logic: `packages/server/agent-review-message.ts`.

Target kinds:

- `local`: local Git/JJ/P4/etc diff.
- `pr`: PR/MR review.
- `workspace`: multiple nested VCS repositories under one workspace root.

Known local Git/JJ diff modes usually do not inline the patch. Instead the
agent gets instructions such as `git diff --staged`, `git diff HEAD~1..HEAD`,
`jj diff --git -r @`, or a merge-base recipe. Unknown modes fall back to
inlining the patch.

PR behavior:

- Remote-only PR review can be just the PR URL.
- PR with local checkout tells the agent it is in a local worktree at PR head
  and should diff against `origin/<base>...HEAD`.
- Full-stack stacked PR review inlines the accumulated stack diff.

Workspace behavior:

- The prompt inlines the combined workspace patch.
- Changed paths are prefixed by child repo folder.
- Findings must report paths exactly as shown in the diff.
- Agents are told not to use bare repo-relative paths or absolute paths.

## Code Tour Protocol

Implementation:

- Shared output types: `packages/shared/tour.ts`.
- Server session: `packages/server/tour/tour-review.ts`.
- UI fetch hook/dialog: `packages/review-editor/hooks/tour/useTourData.ts`,
  `packages/review-editor/components/tour/TourDialog.tsx`.

Code Tour uses the same `/api/agents/jobs` transport with provider `tour`.
The launch payload includes `engine: "claude" | "codex"` and the model/effort
settings for that engine.

Tour output shape:

- `title`
- `greeting`
- `intent`
- `before`
- `after`
- `key_takeaways`
- `stops`
- `qa_checklist`

Each stop has anchors with `file`, `line`, `end_line`, `hunk`, and `label`.
The prompt requires every anchor hunk to contain real unified diff text.

Claude tour:

- Uses `claude -p`.
- Uses stream JSON and an inline JSON schema.
- Prompt is written to stdin.
- stdout is captured and parsed by `parseTourStreamOutput()`.

Codex tour:

- Uses `codex exec`.
- Materializes the tour schema to the Plannotator data dir.
- Writes structured output to a temp file.
- Parsed by `parseTourFileOutput()`.

Tour result storage:

- `createTourSession()` stores successful tours in an in-memory
  `Map<jobId, CodeTourOutput>`.
- Checklists are stored in a second in-memory map.
- `GET /api/tour/:jobId` returns the tour plus checklist state.
- `PUT /api/tour/:jobId/checklist` persists checklist booleans for the session.
- If a process exits 0 but no usable tour is parsed, the job is changed to
  `failed` with `TOUR_EMPTY_OUTPUT_ERROR`.

Code Tour does not create external annotations. It is explanatory, not a
finding pipeline.

## External Diff Annotation Protocol

Shared validation/store: `packages/shared/external-annotation.ts`.
Bun HTTP adapter: `packages/server/external-annotations.ts`.
Pi HTTP adapter: `apps/pi-extension/server/external-annotations.ts`.
UI hook: `packages/ui/hooks/useExternalAnnotations.ts`.

HTTP endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/external-annotations/stream` | GET | SSE snapshot and mutation stream. |
| `/api/external-annotations?since=N` | GET | Polling fallback, 304 when unchanged. |
| `/api/external-annotations` | POST | Add one annotation or a batch. |
| `/api/external-annotations?id=<id>` | PATCH | Update one annotation. |
| `/api/external-annotations?id=<id>` | DELETE | Delete one annotation. |
| `/api/external-annotations?source=<source>` | DELETE | Delete annotations by source. |
| `/api/external-annotations` | DELETE | Clear all external annotations. |

Accepted POST forms:

```json
{
  "source": "agent-example",
  "filePath": "packages/server/review.ts",
  "lineStart": 430,
  "lineEnd": 470,
  "side": "new",
  "type": "comment",
  "scope": "line",
  "text": "This finding appears in the changed code."
}
```

```json
{
  "annotations": [
    {
      "source": "agent-example",
      "filePath": "packages/server/review.ts",
      "lineStart": 430,
      "lineEnd": 470,
      "side": "new",
      "type": "comment",
      "scope": "line",
      "text": "This finding appears in the changed code."
    }
  ]
}
```

Review-mode fields:

- Required:
  - `source`
  - `filePath`
  - `lineStart`
  - `lineEnd`
  - one of `text` or `suggestedCode`
- Optional:
  - `side`: `old` or `new`, defaults to `new`.
  - `type`: `comment`, `suggestion`, or `concern`, defaults to `comment`.
  - `scope`: `line` or `file`, defaults to `line`.
  - `suggestedCode`
  - `originalCode`
  - `author`
  - `severity`
  - `reasoning`

Server-assigned fields:

- `id`
- `createdAt`

Programmatic creation path for built-in agents:

1. Claude/Codex process exits successfully.
2. `onJobComplete()` parses provider output.
3. Provider findings are transformed into the same review annotation input
   shape accepted by the HTTP API.
4. `externalAnnotations.addAnnotations({ annotations })` validates and stores
   them without doing an HTTP round trip.
5. The shared annotation store broadcasts an `add` event over SSE.

Programmatic creation path for external tools:

1. Read `PLANNOTATOR_API_URL`.
2. Read `PLANNOTATOR_AGENT_SOURCE`.
3. POST review annotation JSON to
   `$PLANNOTATOR_API_URL/api/external-annotations`.
4. Use the env-provided source so the UI groups annotations under the job.

Diff anchoring:

- Review annotations use post-change line numbers for `side: "new"` and
  pre-change line numbers for `side: "old"`.
- The diff UI maps `new` to Pierre `additions` and `old` to Pierre
  `deletions`.
- Line-scoped annotations render on `lineEnd`.
- File-scoped annotations are sidebar/header comments, not gutter markers.
- In PR stack mode, annotations can include `prUrl` and `diffScope`.

## Manual Annotation Flow in Review UI

Main owner: `packages/review-editor/App.tsx`.

Manual line comments follow the same `CodeAnnotation` shape:

1. User selects diff lines.
2. `pendingSelection` records start, end, and side.
3. `handleAddAnnotationForFile()` creates a `CodeAnnotation`.
4. `useAnnotationFactory()` attaches PR context when applicable.
5. Annotation is added to local state.

External and local annotations are merged:

- Local annotations live in `annotations`.
- SSE-delivered annotations live in `externalAnnotations`.
- `allAnnotations` dedupes draft-restored external annotations against live
  SSE versions.
- Editing or deleting an external annotation routes to PATCH/DELETE.

Submission:

- `exportReviewFeedback()` renders markdown from `allAnnotations`.
- UI POSTs `/api/feedback` with `approved`, `feedback`, `annotations`, and
  optional `agentSwitch`.
- Server resolves the review decision promise.
- The CLI prints feedback to stdout.

## Diff Rendering of Annotations

Single-file diff:

- `packages/review-editor/components/DiffViewer.tsx`
- Maps `CodeAnnotation` to Pierre line annotations:
  - `side: "new"` -> `additions`
  - `side: "old"` -> `deletions`
  - `lineNumber: lineEnd`
  - metadata includes id, type, text, suggestion, author, severity, reasoning,
    conventional labels, and decorations.

All-files diff:

- `packages/review-editor/components/AllFilesCodeView.tsx`
- Uses the same projection as the single-file diff.
- Filters by file path, PR URL, and PR diff scope.
- Updates only files whose annotation signature changed to avoid remounting
  the whole code view.

Sidebar and job details:

- `packages/review-editor/components/ReviewSidebar.tsx` groups annotations by
  file and, in multi-PR cases, by PR.
- `packages/review-editor/dock/panels/ReviewAgentJobDetailPanel.tsx` groups
  findings for one job source and preserves deleted findings as dismissed.

## Ask AI Protocol

This is separate from background review jobs.

Core package: `packages/ai/`.
Server mount: `packages/server/ai-runtime.ts`.
Review UI hook: `packages/review-editor/hooks/useAIChat.ts`.
Shared UI hook: `packages/ui/hooks/useAIChat.ts`.

Provider contract:

- `AIProvider`
- `AISession`
- `AIMessage`
- `CreateSessionOptions`

HTTP endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/ai/capabilities` | GET | Lists registered providers, models, and default provider. |
| `/api/ai/session` | POST | Creates or forks a provider session. |
| `/api/ai/query` | POST | Streams normalized `AIMessage` SSE events. |
| `/api/ai/abort` | POST | Aborts active provider query. |
| `/api/ai/permission` | POST | Sends user allow/deny response to a provider permission request. |
| `/api/ai/sessions` | GET | Lists tracked in-memory sessions. |

Context:

- `packages/ai/context.ts` builds provider-neutral prompts for plan review,
  code review, and annotate mode.
- Code review context includes the diff patch, optional file path, optional
  selected line range, selected code, and user annotations.
- Large plan/diff inputs are truncated before prompt injection.

Claude Agent SDK provider:

- File: `packages/ai/providers/claude-agent-sdk.ts`.
- Uses `@anthropic-ai/claude-agent-sdk`.
- Supports true fork, resume, streaming, and tools.
- Fresh sessions use Claude Code preset prompt plus appended Plannotator
  context.
- Forked sessions resume parent session with `forkSession: true` and inject a
  Plannotator preamble on the first query.
- Permission requests are bridged back with `control_response`.

Codex SDK provider:

- File: `packages/ai/providers/codex-sdk.ts`.
- Uses `@openai/codex-sdk`.
- Supports resume, streaming, and tools.
- Does not support true fork. The endpoint layer falls back to a fresh session.
- Defaults to read-only sandbox mode.
- Maps Codex thread/item events into normalized AI messages.
- Text deltas are computed from cumulative `agent_message` text updates.

Provider registration:

- Bun runtime registers Claude and Codex providers when their SDK packages can
  be imported, passing explicit CLI paths when found. Pi and OpenCode providers
  are registered only when their CLIs are found.
- Pi runtime mirrors this through generated provider files and Node adapters.
- The UI chooses a default provider from detected Plannotator origin, user
  cookies, and server default.

## Bun and Pi Runtime Parity

Bun server source:

- `packages/server/review.ts`
- `packages/server/agent-jobs.ts`
- `packages/server/external-annotations.ts`
- `packages/server/ai-runtime.ts`

Pi server mirror:

- `apps/pi-extension/server/serverReview.ts`
- `apps/pi-extension/server/agent-jobs.ts`
- `apps/pi-extension/server/external-annotations.ts`
- `apps/pi-extension/server/ai-runtime.ts`

Shared or vendored sources:

- `packages/shared/agent-jobs.ts`
- `packages/shared/external-annotation.ts`
- `packages/shared/tour.ts`
- `packages/ai/*`
- `packages/server/agent-review-message.ts`
- `packages/server/claude-review.ts`
- `packages/server/codex-review.ts`
- `packages/server/tour/tour-review.ts`

Pi vendoring:

- `apps/pi-extension/vendor.sh` copies shared/server/AI modules into
  `apps/pi-extension/generated/`.
- If you add a new shared or review-agent source module needed by Pi, update
  `vendor.sh`.
- Do not edit generated files directly.

## Relevant File Map

Entry and command surfaces:

- `apps/skills/core/plannotator-review/SKILL.md`: generic agent skill that
  runs `plannotator review`.
- `apps/skills/core/plannotator-review/agents/openai.yaml`: OpenAI skill
  metadata.
- `apps/skills/claude/plannotator-review/SKILL.md`: Claude-specific skill
  with `Bash(plannotator:*)`.
- `apps/hook/server/index.ts`: main CLI entry, review arg parsing, diff/PR
  capture, server startup, stdout feedback.
- `apps/opencode-plugin/index.ts`: OpenCode command interception and embedded
  runtime bridge.
- `apps/codex/README.md`: Codex user-facing command docs.
- `apps/droid-plugin/commands/plannotator-review.js`: Droid wrapper.
- `apps/pi-extension/index.ts`: Pi command registration.
- `apps/pi-extension/plannotator-browser.ts`: Pi browser review startup.

Review server and diff context:

- `packages/server/review.ts`: central Bun code review server, endpoints,
  agent jobs, external annotations, AI endpoints, PR mode, workspace mode.
- `packages/server/review-workspace.ts`: server workspace diff support.
- `packages/shared/review-workspace.ts`: workspace prompt/context contracts.
- `packages/shared/review-core.ts`: shared review diff selection logic.
- `packages/shared/review-args.ts`: review CLI arg parsing.
- `packages/shared/pr-stack.ts`: stacked PR diff scope and full-stack diff
  helpers.
- `packages/server/pr.ts`: GitHub/GitLab PR metadata, diffs, reviews, viewed
  files.
- `packages/server/vcs.ts`: Git/JJ/P4 diff execution and CWD resolution.

Agent job transport:

- `packages/shared/agent-jobs.ts`: shared job types, events, state helpers.
- `packages/server/agent-jobs.ts`: Bun HTTP/SSE/process adapter.
- `apps/pi-extension/server/agent-jobs.ts`: Pi Node/http/process adapter.
- `packages/ui/hooks/useAgentJobs.ts`: UI SSE/polling hook and launch/kill API.
- `packages/ui/components/AgentsTab.tsx`: Review Agents launch panel and job
  list.
- `packages/ui/hooks/useAgentSettings.ts`: persisted agent mode/engine/model
  defaults.

Claude, Codex, and tour jobs:

- `packages/server/agent-review-message.ts`: provider-neutral review user
  message builder.
- `packages/server/claude-review.ts`: Claude prompt, command builder, parser,
  finding transform, live log formatter.
- `packages/server/codex-review.ts`: Codex prompt, schema materialization,
  command builder, output parser, finding transform.
- `packages/server/tour/tour-review.ts`: tour prompt, schema, Claude/Codex
  tour command builders, parsers, in-memory tour session.
- `packages/shared/tour.ts`: tour output types shared with UI.

External annotations:

- `packages/shared/external-annotation.ts`: validation, in-memory store,
  mutation events.
- `packages/server/external-annotations.ts`: Bun HTTP/SSE adapter.
- `apps/pi-extension/server/external-annotations.ts`: Pi Node/http adapter.
- `packages/ui/hooks/useExternalAnnotations.ts`: UI SSE/polling hook.
- `packages/ui/types.ts`: `CodeAnnotation`, `DiffAnnotationMetadata`, severity
  styles.
- `packages/review-editor/hooks/useAnnotationFactory.ts`: attaches PR context
  to local annotations.
- `packages/review-editor/utils/exportFeedback.ts`: renders annotation
  markdown for agents and job detail copy.

Review UI:

- `packages/review-editor/App.tsx`: review UI state owner, annotation merge,
  agent job hook, AI hook, feedback submission.
- `packages/review-editor/components/DiffViewer.tsx`: single-file Pierre diff
  rendering and annotation projection.
- `packages/review-editor/components/AllFilesCodeView.tsx`: all-files diff
  rendering and annotation projection.
- `packages/review-editor/components/InlineAnnotation.tsx`: inline rendered
  annotation body inside diff views, including severity, reasoning, and
  suggested code display.
- `packages/review-editor/components/ToolbarHost.tsx`: isolates toolbar state
  from parent diff lists and exposes imperative annotation-edit hooks.
- `packages/review-editor/hooks/useAnnotationToolbar.ts`: manual line/token
  selection, draft preservation, suggestion original-code extraction, and
  annotation submit/edit behavior.
- `packages/review-editor/components/AnnotationToolbar.tsx`: floating form for
  manual comments, suggestions, conventional labels, and Ask AI handoff.
- `packages/review-editor/components/SuggestionBlock.tsx`: renders suggested
  code blocks attached to annotations.
- `packages/review-editor/components/SuggestionModal.tsx`: expanded editor for
  larger suggested-code edits.
- `packages/review-editor/components/ReviewSidebar.tsx`: annotations, AI, and
  agents tabs.
- `packages/review-editor/dock/ReviewStateContext.tsx`: shared dock panel
  state.
- `packages/review-editor/dock/JobLogsContext.tsx`: job log context for dock
  panels.
- `packages/review-editor/dock/panels/ReviewAgentJobDetailPanel.tsx`: job
  detail, findings snapshot, logs, copied prompt/command.
- `packages/review-editor/hooks/tour/useTourData.ts`: tour fetch/checklist
  hook.
- `packages/review-editor/components/tour/TourDialog.tsx`: tour UI.
- `packages/review-editor/components/tour/TourStopCard.tsx`: tour stop and
  diff hunk rendering.
- `packages/review-editor/components/DiffHunkPreview.tsx`: robust tour hunk
  preview rendering.
- `packages/review-editor/utils/patchParser.ts`: extracts selected code from a
  patch for suggestions and Ask AI prompts.

Ask AI:

- `packages/ai/types.ts`: provider/session/message contracts.
- `packages/ai/provider.ts`: provider registry and factory creation.
- `packages/ai/session-manager.ts`: in-memory AI session tracking and ID
  remapping.
- `packages/ai/endpoints.ts`: `/api/ai/*` endpoint implementations.
- `packages/ai/context.ts`: context-to-prompt builders.
- `packages/ai/base-session.ts`: shared session lifecycle/abort behavior.
- `packages/ai/providers/claude-agent-sdk.ts`: Claude Agent SDK provider.
- `packages/ai/providers/codex-sdk.ts`: Codex SDK provider.
- `packages/server/ai-runtime.ts`: Bun provider registration and endpoint
  mount.
- `apps/pi-extension/server/ai-runtime.ts`: Pi provider registration and
  Node/http bridge.
- `packages/ui/hooks/useAIChat.ts`: shared UI session/query stream hook.
- `packages/review-editor/hooks/useAIChat.ts`: code-review wrapper around the
  shared hook.
- `packages/ui/utils/aiProvider.ts`: provider/model default selection.

Tests and verification:

- `packages/server/agent-review-message.test.ts`: review prompt construction
  including local diff instructions, workspace path rules, and Claude command
  allowlist.
- `packages/server/tour/tour-review.test.ts`: tour prompt construction,
  Claude command allowlist, stream/file parsing.
- `packages/server/external-annotations.test.ts`: external annotation SSE
  idle-timeout behavior.
- `packages/ai/ai.test.ts`: session manager, endpoint behavior, Codex SDK
  event mapping, multi-provider capabilities.
- `packages/review-editor/utils/exportFeedback.test.ts`: feedback markdown
  formatting.
- `packages/review-editor/utils/exportFeedback.workspace.test.ts`: workspace
  feedback formatting.
- `apps/pi-extension/server.test.ts`: Pi server review endpoint parity.

## Change Checklist

When changing background review agents:

1. Update shared contracts first (`packages/shared/agent-jobs.ts` or
   `packages/shared/external-annotation.ts`) if the wire shape changes.
2. Update the Bun adapter in `packages/server/*`.
3. Update the Pi adapter in `apps/pi-extension/server/*`.
4. If Pi needs generated source changes, update `apps/pi-extension/vendor.sh`.
5. Update UI hooks and components that consume the shape.
6. Update export/feedback behavior if annotation metadata changes.
7. Add or update tests for:
   - command construction,
   - provider output parsing,
   - transform-to-annotation behavior,
   - SSE/polling behavior,
   - Pi parity when relevant.

When changing Claude review:

1. Keep command prompt-on-stdin behavior unless there is a strong reason to
   change it.
2. Keep the allowlist read-oriented and the denylist write/network/shell
   oriented.
3. Update `CLAUDE_REVIEW_SCHEMA_JSON`, parser, transform, UI severity display,
   and tests together.
4. Remember that tour-with-Claude also streams Claude JSONL and uses the same
   live log formatter.

When changing Codex review:

1. Keep schema materialization to a real file.
2. Keep temp output cleanup on success and failure.
3. Update schema, parser, transform, and tests together.
4. If a new Codex CLI flag is added, put global flags before `exec`.

When changing Code Tour:

1. Keep `tour` as a job provider, not an annotation producer.
2. Keep tour output stored by job id and fetched through `/api/tour/:jobId`.
3. Treat empty or malformed tour output as a failed job.
4. Update shared tour types, schema, parser, UI hook, and dialog together.

When changing external annotations:

1. Preserve single-object and batch POST forms.
2. Preserve SSE snapshot-on-connect and polling `since` fallback.
3. Keep server-assigned ids and timestamps.
4. Validate line numbers and required text/suggestion inputs server-side.
5. Keep local and external annotation edit/delete paths distinct in the UI.

When changing Ask AI:

1. Do not confuse provider sessions with background review jobs.
2. If provider capability semantics change, update `/api/ai/session` fork
   fallback behavior.
3. Keep permission responses normalized through `respondToPermission()`.
4. Keep context truncation and review-specific prompt builders in
   `packages/ai/context.ts`.

## Common Failure Modes

- Job launches in the wrong cwd:
  check PR checkout warmup, `resolveAgentCwdReady()`, worktree path existence,
  and launch-time state snapshotting.

- Agent findings appear under the wrong PR or diff scope:
  check `job.prUrl`, `job.diffScope`, PR switch cache, and transform mapping in
  `onJobComplete()`.

- Job detail "Copy All" has the wrong diff header:
  check `job.diffContext` and `ReviewAgentJobDetailPanel`.

- Claude job finishes with no findings and no verdict:
  inspect stream JSON final result parsing and stdout capture.

- Codex job exits 0 but no annotations appear:
  inspect temp output file contents, schema path, `parseCodexOutput()`, and
  transform validation errors from `externalAnnotations.addAnnotations()`.

- Tour job auto-opens a 404:
  it should not. `onJobComplete()` should mark malformed tour output as failed
  before `job:completed`.

- External annotations show in sidebar but not gutter:
  check `filePath`, `scope`, `side`, `lineEnd`, PR URL, and diff scope filters.

- External annotations disappear after delete but job details still show them:
  this is intentional. Job detail snapshots deleted findings as dismissed.

- Ask AI can read the wrong PR files:
  check `/api/ai/session` PR checkout guard in `packages/server/review.ts`.
