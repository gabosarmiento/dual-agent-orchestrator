import { run } from './process.js';

// Only these literal, audited package-install commands are accepted by the local server.
// User explicitly clicks Install after seeing the package name and command.
export const INSTALLERS = Object.freeze({
  tmux: { command: 'brew', args: ['install', 'tmux'], label: 'Homebrew tmux' },
  claude: { command: 'npm', args: ['install', '--global', '@anthropic-ai/claude-code'], label: 'Claude Code CLI' },
  codex: { command: 'npm', args: ['install', '--global', '@openai/codex'], label: 'OpenAI Codex CLI' },
  gh: { command: 'brew', args: ['install', 'gh'], label: 'GitHub CLI' }
});
export async function installDependency(name, { exec = run } = {}) {
  if (!Object.hasOwn(INSTALLERS, name)) throw Error('Unsupported dependency');
  const { command, args, label } = INSTALLERS[name];
  try {
    const { stdout, stderr } = await exec(command, args, { timeoutMs: 240000 });
    return { installed: true, dependency: name, label, message: (stdout + '\n' + stderr).slice(-1600) };
  } catch (error) {
    throw Error(label + ' installation failed. Check Homebrew/npm prerequisites and retry. ' + error.message.slice(-500));
  }
}
