import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Onboarding } from '../src/onboarding.js';

function fixture() {
  const calls = [];
  const tmux = {
    command: async args => { calls.push({ kind:'command', args }); return { stdout:'' }; },
    sessions: async () => [{ session:'dao-builder-123', pane:'%1', command:'zsh' }, { session:'dao-reviewer-456', pane:'%2', command:'zsh' }],
    type: async (...args) => calls.push({ kind:'type', args })
  };
  const exec = async (command, args, options = {}) => {
    calls.push({ kind:'exec', command, args, options });
    if (command === 'gh') return { stdout: options.env.GH_CONFIG_DIR.includes('/builder/') ? 'gabosarmiento\n' : 'agentgabo\n' };
    if (command === 'claude' || command === 'codex') return { stdout:'authenticated\n' };
    return { stdout:'ok' };
  };
  return { calls, tmux, exec };
}
test('creates two independent credential locations under app state', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-setup-'));
  const setup = new Onboarding({ storage, tmux: fixture().tmux });
  const a = await setup.env('builder'), b = await setup.env('reviewer');
  assert.notEqual(a.GH_CONFIG_DIR, b.GH_CONFIG_DIR);
  assert.ok(a.CLAUDE_CONFIG_DIR);
  assert.ok(b.CODEX_HOME);
  await assert.rejects(setup.env('admin'), /Unknown role/);
});
test('verifies both GitHub identities independently and rejects identical accounts', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-setup-'));
  const { tmux, exec, calls } = fixture();
  const setup = new Onboarding({ storage, tmux, exec });
  const identity = await setup.verifyUniqueGithub();
  assert.equal(identity.builder.github.login, 'gabosarmiento');
  assert.equal(identity.reviewer.github.login, 'agentgabo');
  const checks = calls.filter(c => c.kind === 'exec' && c.command === 'gh');
  assert.notEqual(checks[0].options.env.GH_CONFIG_DIR, checks[1].options.env.GH_CONFIG_DIR);
  const same = new Onboarding({ storage, tmux, exec: async () => ({stdout:'same-account\n'}) });
  await assert.rejects(same.verifyUniqueGithub(), /different GitHub accounts/);
});
test('guided login only targets app-managed role-specific pane', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-setup-'));
  const { tmux, exec, calls } = fixture();
  const setup = new Onboarding({ storage, tmux, exec });
  const workspace = { state:{ roles:{builder:'%1',reviewer:'%2'} } };
  await setup.guidedLogin(workspace,'reviewer','github');
  assert.deepEqual(calls.at(-1).args, ['%2','gh auth login --hostname github.com --git-protocol https --web',true]);
  await assert.rejects(setup.guidedLogin(workspace,'reviewer','claude'), /does not match/);
  tmux.sessions = async () => [{ session:'external',pane:'%2',command:'zsh' }];
  await assert.rejects(setup.guidedLogin(workspace,'reviewer','github'), /app-created isolated session/);
});
test('managed session injects role-local CLI variables without credentials', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-setup-'));
  const { tmux, calls } = fixture();
  const setup = new Onboarding({ storage, tmux });
  const workspace = { state:{repo:'/tmp/repo'}, bind: async (role,target) => ({role,target}) };
  const created = await setup.createSession(workspace,'builder');
  assert.equal(created.role,'builder');
  const args = calls[0].args;
  assert.equal(args[0], 'new-session');
  assert.ok(args.some(a => a.startsWith('GH_CONFIG_DIR=')));
  assert.ok(args.some(a => a.startsWith('CLAUDE_CONFIG_DIR=')));
  assert.equal(args.some(a => a.includes('SECRET')),false);
});
