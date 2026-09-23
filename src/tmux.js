import { run } from './process.js';

const NAME = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET = /^(?:%[0-9]{1,10}|[A-Za-z0-9_][A-Za-z0-9_.:-]{0,95})$/;
export function validSession(name) {
  if (!NAME.test(name)) throw new Error('Invalid session name (letters, numbers, _, - only)');
  return name;
}
export function validTarget(target) {
  if (!TARGET.test(target)) throw new Error('Invalid tmux target');
  return target;
}
export function sanitizeTerminalInput(value) {
  if (typeof value !== 'string' || !value || value.length > 20000 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Input must be 1–20000 printable characters (newlines are not supported)');
  }
  return value;
}
export class Tmux {
  constructor({ exec = run } = {}) { this.exec = exec; }
  command(args, opts = {}) { return this.exec('tmux', args, { timeoutMs: 7000, ...opts }); }
  async available() {
    try { await this.command(['-V']); return true; } catch { return false; }
  }
  async sessions() {
    try {
      const { stdout } = await this.command(['list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_current_command}\t#{pane_current_path}']);
      return stdout.split('\n').filter(Boolean).map(line => {
        const [session, pane, command, cwd] = line.split('\t');
        return { session, pane, command, cwd };
      });
    } catch (error) {
      if (/no server running|failed to connect/.test(error.message)) return [];
      throw error;
    }
  }
  async assertPane(target) {
    validTarget(target);
    const panes = await this.sessions();
    if (!panes.some(p => p.pane === target || p.session === target)) throw new Error('Selected tmux session/pane is not running');
    return target;
  }
  async create(session, cwd) {
    validSession(session);
    if ((await this.sessions()).some(p => p.session === session)) throw new Error('tmux session already exists; attach instead');
    // Start a regular interactive shell; do not inject CLI login or credentials.
    await this.command(['new-session', '-d', '-s', session, '-c', cwd]);
    return session;
  }
  async capture(target, lines = 180) {
    await this.assertPane(target);
    const count = Math.max(10, Math.min(1200, Number(lines) || 180));
    return (await this.command(['capture-pane', '-p', '-J', '-t', target, '-S', '-' + count])).stdout.slice(-120000);
  }
  async type(target, input, submit = false) {
    await this.assertPane(target);
    sanitizeTerminalInput(input);
    // send-keys -l treats content literally, so prompts cannot become tmux key names.
    await this.command(['send-keys', '-t', target, '-l', '--', input]);
    if (submit) await this.command(['send-keys', '-t', target, 'Enter']);
  }
}
