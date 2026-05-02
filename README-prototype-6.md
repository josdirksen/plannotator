<p align="center">
  <img src="apps/marketing/public/og-image.webp" alt="Plannotator" width="80%" />
</p>

<h1 align="center">Plannotator</h1>

<p align="center">
  <strong>Plan and code review for AI coding agents</strong><br/>
  <sub>Annotate plans before execution. Review diffs before commit. Send structured feedback back to the agent.</sub>
</p>

<p align="center">
  <a href="https://github.com/backnotprop/plannotator/releases"><img src="https://img.shields.io/github/v/release/backnotprop/plannotator?style=flat-square&color=blue" alt="Release" /></a>&nbsp;
  <a href="https://github.com/backnotprop/plannotator/stargazers"><img src="https://img.shields.io/github/stars/backnotprop/plannotator?style=flat-square&color=yellow" alt="Stars" /></a>&nbsp;
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT%20%2F%20Apache--2.0-green?style=flat-square" alt="License" /></a>&nbsp;
  <a href="https://plannotator.ai/docs"><img src="https://img.shields.io/badge/docs-plannotator.ai-purple?style=flat-square" alt="Docs" /></a>
</p>

<p align="center">
  <a href="https://plannotator.ai/docs/getting-started/installation/">Install</a> &middot; <a href="https://plannotator.ai/docs/">Docs</a> &middot; <a href="https://share.plannotator.ai">Try it live</a>
</p>

---

## Features

### Plan Review &nbsp; <a href="https://www.youtube.com/watch?v=a_AT7cEN_9I"><img src="https://img.shields.io/badge/▶_Watch_demo-red?style=flat-square&logo=youtube&logoColor=white" alt="Watch demo" /></a>

When your agent proposes a plan, Plannotator intercepts the approval step and opens a review workspace. Annotate inline, mark deletions, write replacements, attach screenshots. Approve or deny with structured feedback.

**Happens automatically** — hooks into your agent's plan mode. No command to run.

<img src="apps/marketing/public/assets/plan-review.webp" alt="Plan review UI with inline annotations" width="100%" />

---

### Code Review

Run `/plannotator-review` for a PR-style diff viewer. Side-by-side or unified diffs, file tree navigation, line-level annotations. Stage or unstage files before committing. Pass a GitHub or GitLab PR URL to review remote pull requests.

Built-in AI assistant to ask questions about the diff as you review.

<img src="readme-assets/code-review-thumbnail.png" alt="Code review with file tree and side-by-side diff" width="100%" />

---

### Annotate Anything

Run `/plannotator-annotate` on any markdown file, HTML page, URL, or folder. Annotate the agent's last message with `/plannotator-last`. Your annotations become structured feedback the agent can use.

Supports `.md`, `.mdx`, `.html`, URLs (fetched via [Jina Reader](https://jina.ai/reader/)), and folder browsing.

<img src="readme-assets/annotate.png" alt="Annotate mode with TOC sidebar and inline annotations" width="100%" />

---

### Plan Diff

When you deny a plan and the agent resubmits, the UI shows exactly what changed. Color-coded rendered diff or raw git-style `+/-` view. Browse and compare any version from the sidebar.

Every revision is saved automatically to version history.

<img src="readme-assets/plan-diff.png" alt="Plan diff showing changes between revisions" width="100%" />

---

### Sharing & Collaboration

Share annotated plans with teammates via URL. A colleague can annotate a shared plan — import their feedback and send it straight to your agent.

**Small plans** encode entirely in the URL hash — no server involved. **Large plans** use E2E encrypted paste (AES-256-GCM, zero-knowledge, [self-hostable](https://plannotator.ai/docs/guides/sharing-and-collaboration/)). Pastes auto-delete after 7 days.

<img src="readme-assets/sharing.png" alt="Sharing portal for live review rooms" width="100%" />

---

## Get Started

Plannotator works with **Claude Code**, **Copilot CLI**, **Gemini CLI**, **OpenCode**, **Pi**, and **Codex**.

**[Installation Guide](https://plannotator.ai/docs/getting-started/installation/)** — setup instructions for every supported agent.

| Agent | Quick reference |
|---|---|
| Claude Code | [apps/hook/README.md](apps/hook/README.md) |
| Copilot CLI | [apps/copilot/README.md](apps/copilot/README.md) |
| Gemini CLI | [apps/gemini/README.md](apps/gemini/README.md) |
| OpenCode | [apps/opencode-plugin/README.md](apps/opencode-plugin/README.md) |
| Pi | [apps/pi-extension/README.md](apps/pi-extension/README.md) |
| Codex | [apps/codex/README.md](apps/codex/README.md) |

---

## Usage

Plan review activates automatically when your agent enters plan mode — no command needed.

### Commands

| Command | Description |
|---|---|
| `/plannotator-review` | Review uncommitted changes in a PR-style diff viewer |
| `/plannotator-review <pr-url>` | Review a GitHub or GitLab pull request by URL |
| `/plannotator-annotate <file>` | Annotate a markdown or HTML file |
| `/plannotator-annotate <folder>` | Browse and annotate files in a directory |
| `/plannotator-annotate <url>` | Fetch a URL and annotate its content |
| `/plannotator-last` | Annotate the agent's last response |

### CLI (Codex, standalone)

```bash
plannotator review                    # review uncommitted changes
plannotator review <pr-url>           # review a GitHub or GitLab PR
plannotator annotate <file|folder|url>
plannotator last                      # annotate last agent message
```

### Diff options

| Flag | Description |
|---|---|
| `--staged` | Review staged changes only |
| `--base <branch>` | Diff against a specific branch (default: `main`) |
| `--hide-whitespace` | Ignore whitespace-only changes |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PLANNOTATOR_REMOTE` | auto-detect | `1` for remote mode (fixed port, no auto-browser) |
| `PLANNOTATOR_PORT` | random / `19432` | Fixed port for the review server |
| `PLANNOTATOR_BROWSER` | system default | Custom browser to open reviews in |
| `PLANNOTATOR_SHARE` | enabled | Set to `disabled` to turn off URL sharing |
| `PLANNOTATOR_JINA` | enabled | `0` to disable Jina Reader for URL annotation |
| `JINA_API_KEY` | — | Jina Reader API key for higher rate limits |

---

## Integrations

| Integration | Description |
|---|---|
| **[VS Code](https://marketplace.visualstudio.com/items?itemName=backnotprop.plannotator-webview)** | Open plans in editor tabs, view diffs inline, sync annotations as editor decorations |
| **Obsidian** | Auto-save approved plans to your vault with frontmatter, tags, and graph backlinks |
| **Bear** | Save plans with nested tags and project metadata |
| **GitHub / GitLab** | Review any pull request by URL with full diff annotations |

---

## Development

```bash
bun install

bun run dev:hook       # Plan review server
bun run dev:review     # Code review editor
bun run dev:marketing  # Marketing site
bun run dev:vscode     # VS Code extension
```

See [CLAUDE.md](CLAUDE.md) for build instructions, project structure, and architecture details.

---

## License

Copyright 2025-2026 [backnotprop](https://github.com/backnotprop)

Dual-licensed under [Apache 2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT) at your option.

Contributions are dual-licensed under the same terms unless you explicitly state otherwise.

---

<p align="center">
  <a href="https://plannotator.ai">plannotator.ai</a> &middot; <a href="https://plannotator.ai/docs/">docs</a> &middot; <a href="https://github.com/backnotprop/plannotator/releases">releases</a>
</p>
