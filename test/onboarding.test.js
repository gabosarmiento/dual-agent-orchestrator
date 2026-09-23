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
  assert.match(args.at(-1), /GH_CONFIG_DIR=/);
  assert.match(args.at(-1), /CLAUDE_CONFIG_DIR=/);
  assert.match(args.at(-1), /'env' '-i'/);
  assert.match(args.at(-1), /'\/bin\/bash' '--noprofile' '--norc' '-i'/);
  assert.doesNotMatch(args.at(-1), /GH_TOKEN=|GITHUB_TOKEN=/);
  assert.equal(args.some(a => a.includes('SECRET')),false);
});

test('inherited GH_TOKEN/GITHUB_TOKEN cannot override managed identities or sessions', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-token-'));
  const { tmux, calls } = fixture();
  const original = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.GH_TOKEN = 'ghp_inherited_token';
  process.env.GITHUB_TOKEN = 'ghp_inherited_fallback';
  try {
    const exec = async (command, args, options = {}) => {
      if (command === 'gh') {
        assert.equal(options.env.GH_TOKEN, undefined);
        assert.equal(options.env.GITHUB_TOKEN, undefined);
        return { stdout: options.env.GH_CONFIG_DIR.includes('/builder/') ? 'gabosarmiento\n' : 'agentgabo\n' };
      }
      return { stdout: 'ok\n' };
    };
    const setup = new Onboarding({ storage, tmux, exec });
    const accounts = await setup.verifyUniqueGithub();
    assert.equal(accounts.builder.github.login, 'gabosarmiento');
    assert.equal(accounts.reviewer.github.login, 'agentgabo');
    await setup.createSession({ state: { repo: '/tmp/repo' }, bind: async () => ({}) }, 'builder');
    const args = calls.find(c => c.kind === 'command').args;
    const bootstrap = args.at(-1);
    assert.match(bootstrap, /'env' '-i'/);
    assert.match(bootstrap, /'\/bin\/bash' '--noprofile' '--norc' '-i'/);
    assert.doesNotMatch(bootstrap, /ghp_inherited_token|ghp_inherited_fallback|GH_TOKEN=|GITHUB_TOKEN=/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('managed shell bootstrap prevents startup token overrides and quotes its paths', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'dao-path-with-space-'));
  const { tmux, calls } = fixture();
  const setup = new Onboarding({ storage, tmux });
  await setup.createSession({ state: { repo: '/tmp/project' }, bind: async () => ({}) }, 'reviewer');
  const args = calls.find(c => c.kind === 'command').args;
  assert.equal(args[0], 'new-session');
  assert.equal(args.length, 8);
  assert.match(args.at(-1), /'CODEX_HOME=/);
  assert.match(args.at(-1), /'GH_CONFIG_DIR=/);
  assert.match(args.at(-1), /'env' '-i'/);
  assert.match(args.at(-1), /'\/bin\/bash' '--noprofile' '--norc' '-i'/);
});
