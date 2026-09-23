import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedLocalHost } from '../src/http-security.js';

test('only literal localhost or 127.0.0.1 Host with expected port is allowed', () => {
  assert.equal(allowedLocalHost('127.0.0.1:4317', 4317), true);
  assert.equal(allowedLocalHost('localhost:4317', 4317), true);
  for (const host of ['evil.example:4317','127.0.0.1.evil.example:4317','localhost.evil:4317','127.0.0.1:4318','[::1]:4317','']) {
    assert.equal(allowedLocalHost(host, 4317), false, host);
  }
});
test('GET terminal endpoint rejects attacker-controlled Host before reading terminal output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dao-http-test-'));
  const port = 48000 + Math.floor(Math.random() * 12000);
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), AGENT_WORKSPACE: root, AGENT_STORAGE: join(root, 'state') },
    stdio: ['ignore','pipe','pipe']
  });
  t.after(() => server.kill());
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const get = host => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/api/terminal/builder', headers: { Host: host }, timeout: 1000 }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('timed out'))); req.end();
  });
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    try { response = await get('attacker.example:' + port); break; }
    catch (error) {
      if (server.exitCode !== null) throw Error('Server exited before readiness: ' + stderr);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(response, 'server should start');
  assert.equal(response.status, 403);
  assert.match(response.body, /Untrusted Host/);
});
