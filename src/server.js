import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Workspace } from './workspace.js';
import { allowedLocalHost } from './http-security.js';
import { run } from './process.js';

const port = Number(process.env.PORT || 4317);
const host = '127.0.0.1', origin = 'http://' + host + ':' + port;
const workspaceRoot = resolve(process.env.AGENT_WORKSPACE || join(homedir(), 'code'));
const storage = resolve(process.env.AGENT_STORAGE || join(homedir(), '.dual-agent-orchestrator'));
const app = new Workspace({ root: workspaceRoot, storage });
await app.load();
const response = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};
const parse = async req => {
  let size = 0, data = '';
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20000) throw new Error('Request exceeds 20KB');
    data += chunk.toString();
  }
  return JSON.parse(data || '{}');
};
const status = async (command, args, env = {}) => {
  try { const { stdout } = await run(command, args, { env, timeoutMs: 9000 }); return { available: true, details: stdout.slice(0, 200) }; }
  catch { return { available: false }; }
};
createServer(async (req, res) => {
  const url = new URL(req.url || '/', origin);
  try {
    if (!allowedLocalHost(req.headers.host, port)) return response(res, 403, { error: 'Untrusted Host' });
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(new URL('../public/index.html', import.meta.url)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return response(res, 200, { ...(await app.snapshot()), allowedWorkspace: workspaceRoot });
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const [tmux, claude, codex] = await Promise.all([
        app.tmux.available(), status('claude', ['--version']), status('codex', ['--version'])
      ]);
      return response(res, 200, { tmux, claude, codex });
    }
    if (req.method === 'GET' && /^\/api\/terminal\/(builder|reviewer)$/.test(url.pathname)) {
      const role = url.pathname.split('/').at(-1);
      return response(res, 200, { role, output: await app.terminal(role) });
    }
    if (req.method === 'GET' && url.pathname === '/api/changes') return response(res, 200, { changes: await app.changes() });
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      const remove = app.on(message => res.write('data: ' + JSON.stringify(message) + '\n\n'));
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { remove(); clearInterval(keepAlive); });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const acceptedOrigins = [origin, 'http://localhost:' + port];
      if (!acceptedOrigins.includes(req.headers.origin) || !String(req.headers['content-type'] || '').startsWith('application/json') ||
          !acceptedOrigins.some(o => req.headers.host === new URL(o).host)) return response(res, 403, { error: 'Local same-origin JSON request required' });
      const input = await parse(req);
      if (url.pathname === '/api/project') return response(res, 200, await app.project(input.repo));
      if (url.pathname === '/api/task') return response(res, 200, await app.setTask(input.prompt));
      if (url.pathname === '/api/bind') return response(res, 200, await app.bind(input.role, input.target));
      if (url.pathname === '/api/create') return response(res, 200, await app.create(input.role));
      if (url.pathname === '/api/input') return response(res, 200, await app.input(input.role, input.text, input.submit === true));
      if (url.pathname === '/api/handoff') return response(res, 200, await app.handoff(input.role, input.message));
    }
    return response(res, 404, { error: 'Not found' });
  } catch (error) { return response(res, 400, { error: error.message }); }
}).listen(port, host, () => {
  console.log('Persistent dual-agent workspace: ' + origin);
  console.log('Allowed projects root: ' + workspaceRoot);
});
