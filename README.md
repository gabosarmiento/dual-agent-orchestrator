# Dual Agent Orchestrator — integrated onboarding prototype

**Phase 3 draft:** The application now guides setup of its own managed Claude, Codex and GitHub sessions directly from the web dashboard. The agents remain available in native macOS Terminal via tmux. This is an early local prototype, **not a production-ready account manager**.

## Start

Requires Node.js >=20, npm and Homebrew installed on macOS. (Homebrew is needed only to install missing tmux/gh through the app.) This version does not install itself or install Homebrew/Node.

```sh
git clone https://github.com/gabosarmiento/dual-agent-orchestrator.git
cd dual-agent-orchestrator
git switch feat/in-app-onboarding
npm test
npm run check
AGENT_WORKSPACE="$HOME/Desktop" npm start
```

Open http://127.0.0.1:4317. Choose the local Git repository that you want to use under `AGENT_WORKSPACE`, e.g. `~/Desktop/kiff-cloud`. If the repo is elsewhere, restart the server with `AGENT_WORKSPACE` set to its parent folder. **No agent/GitHub environment-variable setup is required in your terminal.**

## In-app onboarding

1. The dashboard checks for tmux, Claude Code, Codex, GitHub CLI and Git. When tmux, Claude, Codex, or GitHub CLI is missing, it offers an explicit **Install** button for an allowlisted Homebrew/npm command. Existing installs are left alone. Installation may require system prerequisites or a user-managed npm/Homebrew fix; no invisible `sudo` or password collection.
2. Click **Open project**, then **Create isolated session** once for each agent. The app creates separate persistent tmux shell sessions and separate local CLI authentication directories per role under `~/.dual-agent-orchestrator/credentials`.
3. For each role click **Connect Claude/Connect Codex** and **Connect GitHub A/Connect GitHub B**. The app starts each official CLI login flow inside the relevant session. Follow the provider's browser/device-code/interactive prompts shown in that terminal pane. Login remains with the provider's CLI; the dashboard never receives a password or OAuth token.
4. Click **Refresh connections**, then **Verify separate GitHub identities**. It calls `gh api user --jq .login` independently under each role's configuration to compare usernames. Click **Launch Claude** and **Launch Codex** to start the respective CLI in its persistent session.
5. Continue working in the dashboard or your native terminal via `tmux attach -t <session>` (the dashboard shows the exact attach command). Browser and Terminal see the same ongoing process. An existing externally created tmux session can be mirrored and used for manual handoffs, but **managed login/launch requires an app-created session** to avoid silently inheriting shared credentials.

The application does not change global `gh auth switch` or rewrite your system's Git credentials. Managed GitHub CLI sessions have separate `GH_CONFIG_DIR` directories, but authenticated `git push` and `git fetch` **are not isolated/enforced yet**; Git may use a shared credential helper. Do not assume independent remote Git identities are operational based on login alone.

## Working together

Set shared task instructions. You can type to either CLI from the web dashboard, monitor the two active panes, and explicitly send a review handoff to Codex or a correction handoff to Claude. Keep both agents open and reconnect later from Terminal or the browser.

**Still not implemented:** automatic completion detection and handoffs, isolated verified Git push and PR review account adapters, true PTY/xterm support, automated model selection, AI provider OAuth via a custom app callback, automatic session restoration from agents launched outside tmux, and local end-to-end Mac validation. Guided sign-in takes place inside the official interactive CLIs; the app cannot silently authenticate your accounts.

The web server is a localhost-only terminal-control interface. Do not expose it on the Internet. Account credentials are written by each provider's CLI on your computer, not committed to the repository. This GitHub repository is currently public.

## Development

`npm test` runs process/orchestration, tmux/workspace and setup unit tests. `npm run check` performs syntax checks. GitHub Actions is configured for this feature branch. A passing CI run establishes only the automated checks, not authenticated integration on your Mac.

[Architecture and design limitations](docs/ARCHITECTURE.md)
