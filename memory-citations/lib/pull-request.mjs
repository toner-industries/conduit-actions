// Reads the file the workflow writes with `gh pr view --json body,commits`: the description and every
// commit message, kept as data so nothing in them ever passes through a shell.
import { readFileSync } from 'node:fs';

export function readPullRequest(path) {
  const { body, commits } = JSON.parse(readFileSync(path, 'utf8'));
  return {
    description: typeof body === 'string' ? body : '',
    commitMessages: (Array.isArray(commits) ? commits : []).map((commit) => `${commit.messageHeadline ?? ''}\n${commit.messageBody ?? ''}`),
  };
}
