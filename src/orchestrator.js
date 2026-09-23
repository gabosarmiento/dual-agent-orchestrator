import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { run, sanitized } from './process.js';
import { resolveRepo, prepare, commitBuilder, diffSummary } from './git.js';

const STATES = ['queued', 'preparing', 'coding', 'reviewing', 'fixing', 'verified', 'blocked', 'failed', 'stopped'];
export function nextStage(current, review) {
  if (current !== 'reviewing') throw new Error('Cannot apply review outside reviewing stage');
  if (review === 'PASS') return 'verified';
  if (review === 'CHANGES_REQUIRED') return 'fixing';
  throw new Error('Review outcome must be PASS or CHANGES_REQUIRED');
}
export function parseReview(text) {
  // Require a dedicated final marker; never infer PASS from incidental prose.
  const markers = [...text.matchAll(/^FINAL_VERDICT:[ \t]*(PASS|CHANGES_REQUIRED)[ \t]*$/gm)];
  return markers.length === 1 && text.slice(markers[0].index + markers[0][0].length).trim() === ''
    ? markers[0][1] : 'CHANGES_REQUIRED';
}
export class Orchestrator {
  constructor({ workspace, storage, cli = run }) {
    this.workspace = workspace;
    this.storage = storage;
    this.cli = cli;
    this.tasks = new Map();
    this.listeners = new Set();
    this.writes = new Map();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(task, event, payload = {}) {
    const entry = { at: new Date().toISOString(), taskId: task.id, event, ...payload };
    task.events.push(entry);
    if (task.events.length > 400) task.events.shift();
    for (const listener of this.listeners) listener(entry);
    // Serialized, atomic snapshots; explicit terminal stages await the queue.
    this.save(task).catch(error => { task.persistenceError = error.message; });
  }
  async stage(task, stage) {
    if (!STATES.includes(stage)) throw new Error('Invalid stage');
    task.stage = stage;
    this.emit(task, 'stage', { stage });
    await this.writes.get(task.id);
  }
  save(task) {
    const { controller, ...safe } = task;
    const snapshot = JSON.stringify(safe, null, 2);
    const previous = this.writes.get(task.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await mkdir(this.storage, { recursive: true, mode: 0o700 });
      const path = join(this.storage, task.id + '.json');
      const temp = path + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temp, snapshot, { mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
    });
    this.writes.set(task.id, next);
    return next;
  }
  async load() {
    await mkdir(this.storage, { recursive: true });
    const { readdir } = await import('node:fs/promises');
    for (const name of await readdir(this.storage)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      const task = JSON.parse(await readFile(join(this.storage, name), 'utf8'));
      if (['queued', 'preparing', 'coding', 'reviewing', 'fixing'].includes(task.stage)) task.stage = 'blocked';
      this.tasks.set(task.id, task);
    }
  }
  list() { return [...this.tasks.values()].map(({ controller, ...task }) => task); }
  async start({ repo, prompt, maxIterations = 2 }) {
    if (typeof prompt !== 'string' || prompt.trim().length < 4 || prompt.length > 12000) throw new Error('Task prompt must be 4–12000 characters');
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 3) throw new Error('Iterations must be 1–3');
    const path = await resolveRepo(this.workspace, repo);
    if ([...this.tasks.values()].some(t => t.repo === path && !['verified','blocked','stopped','failed'].includes(t.stage))) throw new Error('A task is already running for this repository');
    const task = { id: randomUUID(), repo: path, prompt, maxIterations, stage: 'queued', events: [], results: [], createdAt: new Date().toISOString(), controller: new AbortController() };
    this.tasks.set(task.id, task);
    this.emit(task, 'created');
    await this.writes.get(task.id);
    void this.execute(task);
    return { id: task.id };
  }
  async agent(task, name, command, args, cwd, env = {}) {
    this.emit(task, 'activity', { agent: name, message: command + ' started' });
    const result = await this.cli(command, args, {
      cwd, env, signal: task.controller.signal, timeoutMs: 30 * 60 * 1000,
      onLine: ({ stream, message }) => this.emit(task, 'output', { agent: name, stream, message: sanitized(message).slice(0, 6000) })
    });
    return result.stdout;
  }
  async execute(task) {
    try {
      await this.stage(task, 'preparing');
      const work = await prepare(task.repo, task.id, join(this.storage, 'worktrees'));
      task.work = work;
      for (let attempt = 1; attempt <= task.maxIterations; attempt++) {
        this.stage(task, attempt === 1 ? 'coding' : 'fixing');
        const previous = task.results.at(-1)?.review || '';
        const instruction = [
          'Implement the following task in this working directory. Edit only files in this repository.',
          task.prompt,
          previous ? 'Address all reviewer feedback from the previous iteration:\n' + previous : '',
          'Run relevant tests. Do not push, merge, deploy, or change Git remotes. Do not commit; the orchestrator commits.',
          'Finish with a concise summary of changes and tests.'
        ].filter(Boolean).join('\n\n');
        const builderOutput = await this.agent(task, 'builder', 'claude',
          ['-p', instruction, '--permission-mode', 'acceptEdits'], work.builder,
          process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {});
        const commit = await commitBuilder(work, attempt);
        this.stage(task, 'reviewing');
        const reviewPrompt = [
          'You are an independent read-only reviewer. Review the committed changes in the CURRENT working tree against base commit ' + work.base + '.',
          'Original task:\n' + task.prompt,
          'Review correctness, tests, security, edge cases, and regressions. Run read-only checks and tests where feasible.',
          'Do not modify files, commit, push, or merge. State specific findings with file paths and suggested fixes.',
          'Your FINAL line must be exactly FINAL_VERDICT: PASS or FINAL_VERDICT: CHANGES_REQUIRED.',
          'Only PASS if you inspected the real changes and found no actionable issues.'
        ].join('\n\n');
        const review = await this.agent(task, 'reviewer', 'codex',
          ['exec', '--sandbox', 'read-only', '-C', work.reviewer, reviewPrompt], work.reviewer,
          process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {});
        const outcome = parseReview(review);
        task.results.push({ attempt, commit, builderOutput: sanitized(builderOutput).slice(-12000), review: sanitized(review).slice(-30000), outcome });
        this.emit(task, 'review', { attempt, outcome, commit: commit.sha });
        const stage = nextStage('reviewing', outcome);
        if (stage === 'verified') {
          task.diff = await diffSummary(work);
          this.stage(task, stage);
          return;
        }
      }
      this.stage(task, 'blocked');
      this.emit(task, 'notice', { message: 'Maximum review attempts reached; manual intervention required.' });
      await this.writes.get(task.id);
    } catch (error) {
      this.stage(task, task.controller?.signal.aborted ? 'stopped' : 'failed');
      this.emit(task, 'error', { message: sanitized(error.message) });
      await this.writes.get(task.id).catch(() => {});
    }
  }
  async stop(id) {
    const task = this.tasks.get(id);
    if (!task) throw new Error('Unknown task');
    if (!task.controller || ['verified','blocked','failed','stopped'].includes(task.stage)) throw new Error('Task is not running');
    task.controller.abort();
    this.emit(task, 'notice', { message: 'Stop requested; preserving all worktrees.' });
  }
}
