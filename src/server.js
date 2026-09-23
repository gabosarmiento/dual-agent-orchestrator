import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { Orchestrator } from './orchestrator.js';
import { run } from './process.js';

const port = Number(process.env.PORT || 4317);
const host = '127.0.0.1';
const origin = 'http://' + host + ':' + port;
const workspace = resolve(process.env.AGENT_WORKSPACE || join(homedir(), 'code'));
const storage = resolve(process.env.AGENT_STORAGE || join(homedir(), '.dual-agent-orchestrator'));
const orchestrator = new Orchestrator({ workspace, storage });
await orchestrator.load();

const send = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
};
const check = async (cmd, args, env = {}) => {
  try { const { stdout } = await run(cmd, args, { env, timeoutMs: 12000 }); return { available: true, details: stdout.trim().slice(0, 500) }; }
  catch (error) { return { available: false, details: error.message.slice(0, 200) }; }
};
const body = async req => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20000) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};
createServer(async (req, res) => {
  const path = new URL(req.url || '/', origin).pathname;
  try {
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(new URL('../public/index.html', import.meta.url)));
      return;
    }
    if (req.method === 'GET' && path === '/api/tasks') return send(res, 200, { tasks: orchestrator.list(), workspace });
    if (req.method === 'GET' && path === '/api/status') {
      const [claude, codex, git, ghA, ghB] = await Promise.all([
        check('claude', ['auth', 'status'], process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {}),
        check('codex', ['login', 'status'], process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
        check('git', ['--version']),
        check('gh', ['auth', 'status'], process.env.GH_CONFIG_DIR_A ? { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR_A } : {}),
        process.env.GH_CONFIG_DIR_B ? check('gh', ['auth', 'status'], { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR_B }) : Promise.resolve({ available: false, details: 'GH_CONFIG_DIR_B not configured' })
      ]);
      return send(res, 200, { claude, codex, git, githubA: ghA, githubB: ghB, githubPublishing: false });
    }
    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(': connected\n\n');
      const unsubscribe = orchestrator.subscribe(event => res.write('data: ' + JSON.stringify(event) + '\n\n'));
      req.on('close', unsubscribe);
      return;
    }
    if (req.method === 'POST' && (path === '/api/tasks' || /^\/api\/tasks\/[a-f0-9-]+\/stop$/.test(path))) {
      if (req.headers.origin !== origin || !String(req.headers['content-type'] || '').startsWith('application/json')) {
        return send(res, 403, { error: 'Invalid browser origin or content type' });
      }
      if (path === '/api/tasks') return send(res, 202, await orchestrator.start(await body(req)));
      const id = path.split('/')[3];
      await orchestrator.stop(id);
      return send(res, 200, { stopping: id });
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 400, { error: error.message });
  }
}).listen(port, host, () => {
  console.log('Dual Agent Orchestrator: ' + origin);
  console.log('Allowed repository workspace: ' + workspace);
});
