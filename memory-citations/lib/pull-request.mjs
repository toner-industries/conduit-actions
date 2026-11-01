// Reads the files the workflow writes, kept as data so nothing in them ever passes through a shell:
// the description and every commit message (`gh pr view --json body,commits`), and every comment.
import { existsSync, readFileSync } from 'node:fs';

export function readPullRequest(path) {
  const { body, commits } = JSON.parse(readFileSync(path, 'utf8'));
  return {
    description: typeof body === 'string' ? body : '',
    commitMessages: (Array.isArray(commits) ? commits : []).map((commit) => `${commit.messageHeadline ?? ''}\n${commit.messageBody ?? ''}`),
  };
}

/**
 * Reads the file the workflow writes from GitHub's comment, review and inline review comment lists:
 * {author, comments: [{author, userType, createdAt, body}]}, author being the pull request's. Any
 * other shape stops the job: verdicts read from part of the comments could score the wrong way.
 */
export function readReviewerComments(path) {
  const { author, comments } = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  if (typeof author !== 'string' || !Array.isArray(comments)) throw new Error(`the comments file ${path} is missing or not the shape the workflow writes`);
  return { author, comments };
}
