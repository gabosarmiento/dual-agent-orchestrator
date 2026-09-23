import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tmux, sanitizeTerminalInput, validSession, validTarget } from '../src/tmux.js';
import { Workspace } from '../src/workspace.js';

test('tmux target and text validation reject unsafe values', () => {
  assert.equal(validTarget('%12'), '%12');
  assert.equal(validSession('dual-builder-a1'), 'dual-builder-a1');
  for (const name of ['a;echo', '-a', '../../etc', '']) assert.throws(() => validTarget(name));
  assert.throws(() => sanitizeTerminalInput('hi\nrm -rf /'));
  assert.throws(() => sanitizeTerminalInput('\x1b[2J'));
});
test('tmux uses literal input and separate Enter key with no shell', async () => {
  const calls = [];
  const tmux = new Tmux({ exec: async (cmd,args) => {
    calls.push({cmd,args});
    if (args[0] === 'list-panes') return { stdout:'dev\t%1\tclaude\t/tmp/repo\nreview\t%2\tcodex\t/tmp/repo\n' };
    return {stdout:'ok'};
  }});
  await tmux.type('%1', 'check $(whoami); hello', true);
  assert.deepEqual(calls.at(-2).args, ['send-keys', '-t', '%1', '-l', '--', 'check $(whoami); hello']);
  assert.deepEqual(calls.at(-1).args, ['send-keys', '-t', '%1', 'Enter']);
});
test('binding persists pane IDs and handoff targets reviewer without replacing sessions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dual-workspace-'));
  const storage = join(root, 'state'); await mkdir(storage);
  const prompts = [];
  const mock = {
    sessions: async () => [{session:'builder',pane:'%1'},{session:'reviewer',pane:'%2'}],
    assertPane: async target => target,
    type: async (...args) => prompts.push(args),
    capture: async () => 'interactive output'
  };
  const exec = async (cmd,args) => ({stdout:args.includes('rev-parse')?'abc123\n':'/tmp/repo\n'});
  const app = new Workspace({root,storage,tmux:mock,exec});
  app.state.repo = '/tmp/repo';
  await app.bind('builder','%1'); await app.bind('reviewer','%2');
  await assert.rejects(app.bind('reviewer','%1'), /different panes/);
  await app.setTask('Fix a race condition');
  await app.handoff('reviewer','Please check locking');
  assert.equal(prompts[0][0],'%2');
  assert.match(prompts[0][1], /Fix a race condition/);
  assert.equal(prompts[0][2], true);
  const restarted = new Workspace({root,storage,tmux:mock,exec});
  await restarted.load();
  assert.equal(restarted.state.roles.reviewer,'%2');
  assert.equal(restarted.state.handoffs.length,1);
});
