import { spawn } from 'node:child_process';

export function run(command, args = [], { cwd, env = {}, signal, onLine = () => {}, timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env: { ...process.env, ...env }, signal,
      shell: false, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    const limit = 2_000_000;
    const append = (kind, chunk) => {
      const message = chunk.toString();
      if (kind === 'stdout') stdout = (stdout + message).slice(-limit);
      else stderr = (stderr + message).slice(-limit);
      onLine({ stream: kind, message });
    };
    child.stdout.on('data', chunk => append('stdout', chunk));
    child.stderr.on('data', chunk => append('stderr', chunk));
    let timer;
    if (timeoutMs) timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, killedBy) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(signal?.aborted ? 'Process stopped' : command + ' exited ' + code + (killedBy ? ' (' + killedBy + ')' : '') + ': ' + stderr.slice(-2500)));
    });
  });
}

export function sanitized(message) {
  return message.replace(/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})/g, '[REDACTED]');
}
