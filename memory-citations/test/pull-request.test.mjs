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
