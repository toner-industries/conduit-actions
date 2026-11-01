import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPullRequest, readReviewerComments } from '../lib/pull-request.mjs';

function written(value) {
  const path = join(mkdtempSync(join(tmpdir(), 'pr-')), 'pr.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

test('reads each commit headline with its own body', () => {
  const path = written({ body: 'x', commits: [{ messageHeadline: 'one', messageBody: 'a' }, { messageHeadline: 'two', messageBody: 'b' }] });
  assert.deepEqual(readPullRequest(path).commitMessages, ['one\na', 'two\nb']);
});

test('reads an empty description as empty text', () => {
  assert.equal(readPullRequest(written({ body: null, commits: [] })).description, '');
});

test('reads the pull request author and every comment', () => {
  const comment = { author: 'julian', userType: 'User', createdAt: '2026-10-31T10:00:00Z', body: 'memory 59ffd1cd: helped' };
  assert.deepEqual(readReviewerComments(written({ author: 'agent-author', comments: [comment] })), { author: 'agent-author', comments: [comment] });
});

test('reads a pull request with no comments', () => {
  assert.deepEqual(readReviewerComments(written({ author: 'agent-author', comments: [] })).comments, []);
});

test('refuses a comments file that is not the shape the workflow writes', () => {
  assert.throws(() => readReviewerComments(written({ errors: ['x'] })), /comments file/);
});

test('refuses a missing comments file', () => {
  assert.throws(() => readReviewerComments(undefined), /comments file/);
});
