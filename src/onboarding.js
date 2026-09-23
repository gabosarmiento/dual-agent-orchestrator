import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './process.js';

const ROLES = ['builder', 'reviewer'];
const PROVIDERS = ['claude', 'codex', 'github'];
const SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh']);
const toolFor = { builder: 'claude', reviewer: 'codex' };
const checkRole = role => { if (!ROLES.includes(role)) throw Error('Unknown role'); return role; };
const checkProvider = provider => { if (!PROVIDERS.includes(provider)) throw Error('Unknown provider'); return provider; };

export class Onboarding {
  constructor({ storage, tmux, exec = run }) {
    this.storage = storage; this.tmux = tmux; this.exec = exec;
  }
  async env(role) {
    checkRole(role);
    const dir = join(this.storage, 'credentials', role);
    const gh = join(dir, 'gh');
    const agent = join(dir, 'agent');
    await mkdir(gh, { recursive: true, mode: 0o700 });
    await mkdir(agent, { recursive: true, mode: 0o700 });
    return role === 'builder'
      ? { GH_CONFIG_DIR: gh, CLAUDE_CONFIG_DIR: agent }
      : { GH_CONFIG_DIR: gh, CODEX_HOME: agent };
  }
  async probe(command, args, env = {}) {
    try {
      const isolatedEnv = command === 'gh' ? { ...env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined } : env;
      const { stdout } = await this.exec(command, args, { env: isolatedEnv, timeoutMs: 9000 });
      return { ok: true, output: stdout.trim().slice(0, 220) };
    } catch { return { ok: false }; }
  }
  async diagnostics() {
    const [tmux, claude, codex, gh, git] = await Promise.all([
      this.probe('tmux', ['-V']), this.probe('claude', ['--version']),
      this.probe('codex', ['--version']), this.probe('gh', ['--version']), this.probe('git', ['--version'])
    ]);
    return { tmux, claude, codex, gh, git };
  }
  async identities() {
    const result = {};
    for (const role of ROLES) {
      const env = await this.env(role);
      const gh = await this.probe('gh', ['api', 'user', '--jq', '.login'], { GH_CONFIG_DIR: env.GH_CONFIG_DIR });
      const ai = role === 'builder'
        ? await this.probe('claude', ['auth', 'status'], { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR })
        : await this.probe('codex', ['login', 'status'], { CODEX_HOME: env.CODEX_HOME });
      result[role] = { github: { connected: gh.ok, login: gh.ok ? gh.output : null }, ai: { connected: ai.ok, provider: toolFor[role] } };
    }
    return result;
  }
  async verifyUniqueGithub() {
    const identities = await this.identities();
    const a = identities.builder.github.login, b = identities.reviewer.github.login;
    if (!a || !b) throw Error('Connect both GitHub accounts before performing cross-account actions');
    if (a.toLowerCase() === b.toLowerCase()) throw Error('Builder and reviewer must use different GitHub accounts');
    return identities;
  }
  async createSession(workspace, role) {
    checkRole(role);
    if (!workspace.state.repo) throw Error('Open a project first');
    const env = await this.env(role);
    // tmux starts a managed login shell with role-specific CLI configuration.
    // These sessions can be attached from macOS Terminal as normal.
    const name = 'dao-' + role + '-' + Date.now().toString(36);
    const args = ['new-session', '-d', '-s', name, '-c', workspace.state.repo];
    for (const [key, value] of Object.entries(env)) args.push('-e', key + '=' + value);
    // A pre-existing token in the parent/tmux server must never override each role's gh login.
    args.push('-e', 'GH_TOKEN=', '-e', 'GITHUB_TOKEN=');
    await this.tmux.command(args);
    return workspace.bind(role, name);
  }
  async guidedLogin(workspace, role, provider) {
    checkRole(role); checkProvider(provider);
    if ((role === 'builder' && provider === 'codex') || (role === 'reviewer' && provider === 'claude')) {
      throw Error('AI provider does not match selected role');
    }
    if (!workspace.state.roles[role]) throw Error('Create or attach a session for this role first');
    const env = await this.env(role);
    const command = provider === 'github' ? 'gh auth login --hostname github.com --git-protocol https --web'
      : provider === 'claude' ? 'claude auth login' : 'codex login';
    // Never paste credentials into the application. The official CLI handles auth.
    // For external manually attached panes env separation cannot be guaranteed.
    const pane = workspace.state.roles[role];
    const metadata = (await this.tmux.sessions()).find(p => p.pane === pane);
    if (!metadata?.session?.startsWith('dao-' + role + '-')) {
      throw Error('Account setup requires an app-created isolated session; existing external sessions are view-only for login');
    }
    if (!SHELLS.has(metadata.command)) throw Error('Return this session to its shell before starting a login flow; the agent is currently running');
    await this.tmux.type(pane, command, true);
    return { launched: true, provider, role, next: 'Follow the official CLI/browser sign-in prompt in the session, then press Refresh connections.' };
  }
  async launchAgent(workspace, role) {
    checkRole(role);
    const pane = workspace.state.roles[role];
    const metadata = (await this.tmux.sessions()).find(p => p.pane === pane);
    if (!metadata?.session?.startsWith('dao-' + role + '-')) throw Error('Use an app-created isolated session for managed agent launch');
    if (!SHELLS.has(metadata.command)) throw Error('Agent appears to be running already; reconnect rather than starting a duplicate');
    const identities = await this.identities();
    if (!identities[role].ai.connected) throw Error('Connect the AI provider for this role first');
    await this.tmux.type(pane, toolFor[role], true);
    return { launched: true, role };
  }
}
