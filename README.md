# Dual Agent Workspace

**Phase 2: persistent shared-session prototype (draft; real Mac integration not yet verified).**

Claude and Codex remain interactive and independent. Use both from the local browser **and** from native terminal windows, against the same persistent tmux sessions. Browser refresh and Node server restart do not stop the agents.

[Reference architecture](docs/ARCHITECTURE.md) · [Phase 1 prototype](https://github.com/gabosarmiento/dual-agent-orchestrator/tree/feat/local-mvp)

## Quick start (macOS)

Requirements: Node.js >=20, Git, tmux (`brew install tmux`), installed Claude Code and Codex CLI. Authenticate **in your own terminal** via official supported login flows. The application does not manage AI credentials or GitHub account identities.

```sh
git clone https://github.com/gabosarmiento/dual-agent-orchestrator.git
cd dual-agent-orchestrator
git switch feat/persistent-workspace
npm test
npm run check
AGENT_WORKSPACE="$HOME/Desktop" npm start
```

Open http://127.0.0.1:4317. `AGENT_WORKSPACE` is an existing directory containing the Git repository that you want to open, not a GitHub URL. For instance, `~/Desktop/kiff-cloud` is selectable when `AGENT_WORKSPACE="$HOME/Desktop"`.

**Use tmux when launching your existing agents:**

```sh
tmux new-session -s kiff-claude -c "$HOME/Desktop/kiff-cloud"
# Now run your usual "claude" command inside this tmux pane.
# In another terminal:
tmux new-session -s kiff-codex -c "$HOME/Desktop/kiff-cloud"
# Now run your usual "codex" command inside this pane.
```

On the dashboard, choose the repository and attach the two different tmux panes under Builder and Reviewer. Continue using either terminal normally: the dashboard reads the same panes and can also send prompts into them. To reconnect later, use `tmux attach -t kiff-claude` and `tmux attach -t kiff-codex` in separate native terminals. **If your CLI sessions were started outside tmux, they cannot be retroactively adopted**; start them inside tmux and use supported CLI resume functionality where available. The dashboard's "New tmux session" creates an interactive shell; type `claude` or `codex` to start the relevant agent.

Set a shared task, inspect the real terminal output and Git working tree, and send explicit handoff prompts to the other agent. Handoff uses the repository's initial and current HEAD as context. It never creates commits, pushes, changes credentials, or merges PRs. A handoff **does inject an instruction into that agent's interactive terminal**, so ensure it is ready for a new prompt first.

## What is and isn't implemented

Implemented: persistent tmux-backed sessions, live browser mirroring (polling), interactive text input, browser ↔ terminal continuity, shared task, session discovery/binding, Git HEAD/status, explicit Claude→Codex and Codex→Claude handoffs, persisted session mappings and notes, loopback-only server and same-origin write checks.

Not implemented: protocol-level agent idle/turn-completion detection, **fully automated** handoffs, two independent verified GitHub identity integrations, automatic PR creation/review/merge, cross-worktree isolation, true xterm.js PTY emulation (dashboard mirrors captured text rather than a complete terminal). When both agents share a working tree, avoid simultaneous writes and review a committed snapshot for reliable findings. Neither Opus 5.5 nor GPT-6 Sol availability is verified; choose models in your local agent CLI. Existing Phase 1 orchestration code remains in the branch for reference but is not wired into the new server.

**Security:** the browser is a local trusted interactive terminal remote control, not a multiuser or Internet-facing service. Do not expose port 4317 or place it behind a public proxy. Anyone with access to your unlocked Mac/browser could send text to your agent. The app never requests or stores login tokens; session output may contain sensitive information and should not be shared. Never connect a pane you do not intend the app to control.

## Validation

`npm test` covers tmux argument handling, persistent workspace handoff, unit-level orchestration and subprocess checks. GitHub Actions is configured for tests and syntax checking. Integration with *your* interactive tmux + Claude + Codex installation remains unverified until you run it locally. The repository is currently public; avoid committing secrets or private project details.
