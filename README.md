# Dual Agent Orchestrator

**Status: Phase 1 prototype, not yet a finished two-GitHub-account MVP.**

Local browser dashboard supervising Claude Code as a builder and Codex as an independent reviewer. Each task has separate Git worktrees. The builder commits locally; the reviewer examines the committed version, reports actionable findings, and can send the builder through another iteration. The web UI streams actual CLI output and retains task history in a local JSON store.

## Requirements

- Node.js 20+, Git, `claude` and `codex` CLIs installed on your Mac.
- Sign in **in your terminal** using the official commands for your installed CLI versions (typically `claude auth login` and `codex login`). Subscriptions/model selection depend on your installed versions and entitlements. This app never asks for ChatGPT/Claude passwords or browser session cookies.
- A local Git repository with a clean working tree, situated under a dedicated workspace such as `~/code`.
- The coding CLIs must be available in `PATH`. Using `claude -p --permission-mode acceptEdits` grants edits to the chosen worktree. Only select code you trust.
- `gh` is optional at this stage: the dashboard can inspect GitHub authentication status, **but it does not push, open PRs, or submit a review on account B**.

## Run locally

```sh
git clone https://github.com/gabosarmiento/dual-agent-orchestrator.git
cd dual-agent-orchestrator
git switch feat/local-mvp
node --version
npm test
AGENT_WORKSPACE="$HOME/code" npm start
```

Open http://127.0.0.1:4317 in a browser on the same computer. The absolute path entered on the dashboard must point to the **root** of a clean repository inside `AGENT_WORKSPACE`. You can override the port with `PORT=4318`.

The app stores session summaries in `~/.dual-agent-orchestrator` and creates two worktrees per task under its `worktrees/` directory. They are deliberately preserved when a task stops; inspect them before deleting anything. The server binds only to loopback and requires same-origin JSON for write endpoints.

## Workflow

1. Start a task in the browser; the server creates isolated builder and reviewer worktrees and branches.
2. Claude Code edits the builder worktree. The orchestrator locally commits the changes, then fast-forwards the reviewer worktree to that commit.
3. Codex runs in read-only sandbox mode in its own worktree and returns findings ending with `FINAL_VERDICT: PASS` or `FINAL_VERDICT: CHANGES_REQUIRED`.
4. The app passes requested changes to Claude, with at most the chosen number of review attempts (1–3). It never silently reports an ambiguous review as passing.
5. Inspect the resulting local branches and worktrees. No remote changes are made by the local app.

**Agent activity is sequential during implementation/review in this version**, though the two distinct CLI sessions/worktrees are provisioned at task creation. Parallel planning/review and fully automatic GitHub PR handoff are follow-up work.

## Independent identities: not yet implemented

The server accepts `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GH_CONFIG_DIR_A` and `GH_CONFIG_DIR_B` for status checks and the corresponding CLIs. Configure these locally if supported by your CLI version. Do **not** rely on `git user.name` as proof of GitHub account identity: local commits in this prototype use an illustrative builder author, not authenticated GitHub A. No GitHub publishing occurs and no identity separation is promised by this first iteration.

Before implementing GitHub publishing, enforce dedicated `GH_CONFIG_DIR` environments and Git credential helpers **for each** git push/fetch or `gh` invocation; authenticate and verify both separately. Require explicit approval for PR creation, remote writes, and merging. Do not silently fall back to the host Git credentials.

## Tests and known limitations

`npm test` covers verdict parsing, state transitions, path boundaries, token-format redaction, subprocess failures, and task snapshot persistence. `npm run check` performs syntax checks.

This code has been committed remotely; it has **not** been run with your local Claude/Codex subscriptions or validated in a real end-to-end coding job. CI is not configured. Read-only Codex sandbox mode may prevent tests that write temporary build artifacts; the review prompt asks for checks where feasible. Prompt or model output can still contain secrets that simple token-pattern redaction will not detect; avoid entering secrets in tasks. Model selection is currently managed by the installed CLI configuration; requested Opus 5.5 / GPT-6 Sol names are **not** verified against your available subscriptions.

## Inspiration

Architecture inspiration: [Untrivial-ai/agent-orchestrator](https://github.com/Untrivial-ai/agent-orchestrator). This prototype is an independent lightweight implementation and does not copy its source.
