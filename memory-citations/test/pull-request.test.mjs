import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPullRequest } from '../lib/pull-request.mjs';

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

test('reads GitHub edit history newest first with each editor and text', async () => {
  const { readEditHistory } = await import('../lib/pull-request.mjs');
  const path = written({ data: { repository: { pullRequest: { author: { login: 'a' }, userContentEdits: { totalCount: 2, nodes: [
    { editor: { login: 'julian', __typename: 'User' }, diff: 'new' }, { editor: { login: 'a', __typename: 'User' }, diff: null }] } } } } });
  assert.deepEqual(readEditHistory(path), { author: 'a', complete: true, edits: [
    { editor: { login: 'julian', type: 'User' }, body: 'new' }, { editor: { login: 'a', type: 'User' }, body: null }] });
});

test('marks the history incomplete when GitHub returned only part of it', async () => {
  const { readEditHistory } = await import('../lib/pull-request.mjs');
  const path = written({ data: { repository: { pullRequest: { author: { login: 'a' }, userContentEdits: { totalCount: 101, nodes: [] } } } } });
  assert.equal(readEditHistory(path).complete, false);
});

test('reads as no history when GitHub refuses the edits to an app token', async () => {
  const { readEditHistory } = await import('../lib/pull-request.mjs');
  const refused = { data: { repository: { pullRequest: { author: { login: 'a' }, userContentEdits: { totalCount: 2, nodes: [null, null] } } } },
    errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }] };
  assert.equal(readEditHistory(written(refused)), null);
});

test('a missing or malformed history file reads as no history', async () => {
  const { readEditHistory } = await import('../lib/pull-request.mjs');
  assert.deepEqual([readEditHistory(undefined), readEditHistory(written({ errors: ['x'] }))], [null, null]);
});
