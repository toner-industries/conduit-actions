// Reads the file the workflow writes with `gh pr view --json body,commits`: the description and every
// commit message, kept as data so nothing in them ever passes through a shell.
import { existsSync, readFileSync } from 'node:fs';

export function readPullRequest(path) {
  const { body, commits } = JSON.parse(readFileSync(path, 'utf8'));
  return {
    description: typeof body === 'string' ? body : '',
    commitMessages: (Array.isArray(commits) ? commits : []).map((commit) => `${commit.messageHeadline ?? ''}\n${commit.messageBody ?? ''}`),
  };
}

/**
 * Reads the file the workflow writes with GitHub's GraphQL `userContentEdits` for the pull request:
 * who changed the description and its whole text after each change, newest first. Null when the file
 * is missing or not that shape, so no tick counts rather than a guess.
 */
export function readEditHistory(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const pullRequest = JSON.parse(readFileSync(path, 'utf8')).data.repository.pullRequest;
    const { totalCount, nodes } = pullRequest.userContentEdits;
    return {
      author: pullRequest.author?.login ?? null,
      complete: totalCount === nodes.length,
      edits: nodes.map((node) => ({
        editor: node.editor ? { login: node.editor.login, type: node.editor.__typename } : null,
        body: typeof node.diff === 'string' ? node.diff : null,
      })),
    };
  } catch {
    return null;
  }
}
