import { realpath, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { run } from './process.js';
import { Tmux } from './tmux.js';
import { resolveRepo } from './git.js';

const ROLES = ['builder', 'reviewer'];
export class Workspace {
  constructor({ root, storage, tmux = new Tmux(), exec = run }) {
    this.root = root; this.storage = storage; this.tmux = tmux; this.exec = exec;
    this.state = { repo: '', prompt: '', roles: {}, head: '', handoffs: [], autoReview: false };
    this.listeners = new Set();
    this.pending = Promise.resolve();
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  event(type, data = {}) { const message = { type, at: new Date().toISOString(), ...data }; for (const fn of this.listeners) fn(message); }
  async save() {
    const snapshot = structuredClone(this.state);
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(this.storage, { recursive: true });
      await writeFile(join(this.storage, 'workspace.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    });
    return this.pending;
  }
  async load() {
    try {
      const file = JSON.parse(await readFile(join(this.storage, 'workspace.json'), 'utf8'));
      if (typeof file.repo === 'string' && typeof file.roles === 'object' && Array.isArray(file.handoffs)) this.state = { ...this.state, ...file, autoReview: false };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Never automatically inject text into terminals after a server restart.
  }
  async project(repo) {
    const path = await resolveRepo(this.root, repo);
    this.state = { repo: path, prompt: '', roles: {}, head: '', handoffs: [], autoReview: false };
    await this.save(); this.event('workspace');
    return this.snapshot();
  }
  async bind(role, target) {
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (!this.state.repo) throw new Error('Select a repository first');
    const pane = await this.tmux.assertPane(target);
    const panes = await this.tmux.sessions();
    const match = panes.find(p => p.pane === pane || p.session === pane);
    if (Object.entries(this.state.roles).some(([r, t]) => r !== role && t === match.pane)) throw new Error('Builder and reviewer must use different panes');
    const existing = this.state.roles[role];
    this.state.roles[role] = match.pane;
    await this.save(); this.event('bind', { role, pane: match.pane, previous: existing });
    return this.snapshot();
  }
  async create(role) {
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (!this.state.repo) throw new Error('Select a repository first');
    const session = 'dual-' + role + '-' + Date.now().toString(36);
    await this.tmux.create(session, this.state.repo);
    return this.bind(role, session);
  }
  async terminal(role, lines = 180) {
    const target = this.state.roles[role];
    if (!target) throw new Error('Role not connected');
    return this.tmux.capture(target, lines);
  }
  async input(role, text, submit = false) {
    const target = this.state.roles[role];
    if (!target) throw new Error('Role not connected');
    await this.tmux.type(target, text, submit);
    this.event('input', { role });
    return { ok: true };
  }
  async head() {
    if (!this.state.repo) return '';
    const { stdout } = await this.exec('git', ['rev-parse', 'HEAD'], { cwd: this.state.repo, timeoutMs: 7000 });
    return stdout.trim();
  }
  async changes() {
    if (!this.state.repo) throw new Error('Select a repository');
    const { stdout } = await this.exec('git', ['status', '--short'], { cwd: this.state.repo, timeoutMs: 7000 });
    return stdout.slice(0, 12000);
  }
  async setTask(prompt) {
    if (!this.state.repo) throw new Error('Select a repository first');
    if (typeof prompt !== 'string' || prompt.trim().length < 4 || prompt.length > 12000) throw new Error('Task must be 4–12000 characters');
    this.state.prompt = prompt.trim();
    this.state.head = await this.head();
    this.state.handoffs = [];
    await this.save(); this.event('task');
    return this.snapshot();
  }
  async handoff(role, message) {
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    if (!this.state.roles[role]) throw new Error('Target session not connected');
    if (!this.state.prompt) throw new Error('Create a task first');
    const note = typeof message === 'string' ? message.trim().slice(0, 6000) : '';
    const sha = await this.head();
    const prompt = role === 'reviewer'
      ? ['Review the current repository changes independently. Task: ' + this.state.prompt,
        'Base commit when task started: ' + this.state.head, 'Current HEAD: ' + sha,
        'Read the actual diff and run relevant tests. Do not commit, push, or merge. Give actionable findings with file paths.',
        'When finished, end your response with the single line DA_VERDICT: PASS or DA_VERDICT: CHANGES_REQUIRED.',
        note ? 'Builder note: ' + note : ''].filter(Boolean).join('\n\n')
      : ['Address the independent review findings for this task: ' + this.state.prompt,
        'Reviewer feedback:\n' + note,
        'Inspect the actual files and tests; commit changes when ready. Do not push or merge without approval.'].join('\n\n');
    await this.tmux.type(this.state.roles[role], prompt, true);
    const handoff = { to: role, sha, note, at: new Date().toISOString() };
    this.state.handoffs.push(handoff);
    this.state.handoffs = this.state.handoffs.slice(-50);
    await this.save(); this.event('handoff', { handoff });
    return handoff;
  }
  async snapshot() {
    const sessions = await this.tmux.sessions();
    const roles = Object.fromEntries(ROLES.map(role => [role, {
      pane: this.state.roles[role] || '',
      connected: sessions.some(p => p.pane === this.state.roles[role]),
      session: sessions.find(p => p.pane === this.state.roles[role])?.session || ''
    }]));
    return { ...this.state, roles, sessions, currentHead: this.state.repo ? await this.head().catch(() => '') : '' };
  }
}
