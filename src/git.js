import { realpath, mkdir } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { run } from './process.js';

export function assertWorkspace(root, selected) {
  const rel = relative(root, selected);
  if (!isAbsolute(selected) || rel.startsWith('..') || isAbsolute(rel) || !rel || rel.split(/[\\/]/).includes('.git')) {
    throw new Error('Select an existing repository inside the configured workspace, not the workspace itself');
  }
  return selected;
}

export async function resolveRepo(workspace, requested) {
  const root = await realpath(workspace);
  const path = assertWorkspace(root, await realpath(requested));
  const top = (await run('git', ['rev-parse', '--show-toplevel'], { cwd: path })).stdout.trim();
  if (resolve(top) !== path) throw new Error('Select a Git repository root, not a nested directory');
  const clean = (await run('git', ['status', '--porcelain'], { cwd: path })).stdout.trim();
  if (clean) throw new Error('Repository must have a clean working tree before starting');
  return path;
}

export async function git(repo, args, opts = {}) {
  return run('git', args, { cwd: repo, ...opts });
}

export async function prepare(repo, taskId, workRoot) {
  const branch = 'agent/builder-' + taskId;
  const reviewerBranch = 'agent/reviewer-' + taskId;
  const root = join(workRoot, taskId);
  await mkdir(root, { recursive: true });
  const builder = join(root, 'builder');
  const reviewer = join(root, 'reviewer');
  const base = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(repo, ['worktree', 'add', '-b', branch, builder, base]);
  try {
    await git(repo, ['worktree', 'add', '-b', reviewerBranch, reviewer, base]);
  } catch (error) {
    await git(repo, ['worktree', 'remove', '--force', builder]);
    throw error;
  }
  return { repo, builder, reviewer, branch, reviewerBranch, base };
}

export async function commitBuilder(work, iteration) {
  await git(work.builder, ['add', '-A']);
  const changed = (await git(work.builder, ['diff', '--cached', '--name-only'])).stdout.trim();
  if (!changed) throw new Error('Builder produced no changes to commit');
  await git(work.builder, ['-c', 'user.name=Dual Agent Builder', '-c', 'user.email=builder@users.noreply.github.com',
    'commit', '-m', 'agent: implement task (iteration ' + iteration + ')']);
  const sha = (await git(work.builder, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(work.reviewer, ['merge', '--ff-only', sha]);
  return { sha, changed };
}

export async function diffSummary(work) {
  return (await git(work.builder, ['diff', '--stat', work.base + '..HEAD'])).stdout;
}

// Git author labels are not GitHub authentication. Publishing is deliberately
// separate from local commits. A later iteration will implement per-agent gh
// operations with distinct GH_CONFIG_DIR credential stores.
