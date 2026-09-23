import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nextStage, parseReview, Orchestrator } from '../src/orchestrator.js';
import { assertWorkspace } from '../src/git.js';
import { sanitized, run } from '../src/process.js';

test('review is accepted only with one explicit verdict marker', () => {
  assert.equal(parseReview('Findings: none\nFINAL_VERDICT: PASS\n'), 'PASS');
  assert.equal(parseReview('I think PASS'), 'CHANGES_REQUIRED');
  assert.equal(parseReview('FINAL_VERDICT: PASS\nFINAL_VERDICT: CHANGES_REQUIRED'), 'CHANGES_REQUIRED');
  assert.equal(parseReview('FINAL_VERDICT: CHANGES_REQUIRED'), 'CHANGES_REQUIRED');
});
test('stage transitions are explicit', () => {
  assert.equal(nextStage('reviewing', 'PASS'), 'verified');
  assert.equal(nextStage('reviewing', 'CHANGES_REQUIRED'), 'fixing');
  assert.throws(() => nextStage('coding', 'PASS'));
});
test('workspace check blocks repository traversal', () => {
  assert.equal(assertWorkspace('/code', '/code/project'), '/code/project');
  assert.throws(() => assertWorkspace('/code', '/tmp/project'));
  assert.throws(() => assertWorkspace('/code', '/code'));
  assert.throws(() => assertWorkspace('/code', '/code/../private'));
});
test('safe logs redact known token formats', () => {
  assert.equal(sanitized('Authorization ghp_abcdefghijklmno'), 'Authorization [REDACTED]');
});
test('process runner captures output and handles nonzero status', async () => {
  const output = await run(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(output.stdout, 'ok');
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(3)']), /exited 3/);
});
test('persist and load completed task snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dual-agent-test-'));
  const storage = join(root, 'state');
  await mkdir(storage);
  const app = new Orchestrator({ workspace: root, storage });
  const task = { id: '12345678-1234-1234-1234-123456789abc', repo: root, stage: 'verified', events: [], results: [], controller: new AbortController() };
  app.tasks.set(task.id, task);
  await app.save(task);
  const restarted = new Orchestrator({ workspace: root, storage });
  await restarted.load();
  assert.equal(restarted.list()[0].stage, 'verified');
});
