import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreedVerdict, reviewerVerdicts } from '../lib/verdicts.mjs';

const AUTHOR = 'agent-author';
const CITED = ['59ffd1cd', 'aaaaaaaa'];

function comment(body, { author = 'julian', userType = 'User', createdAt = '2026-10-31T10:00:00Z' } = {}) {
  return { author, userType, createdAt, body };
}

function counted(comments, cited = CITED) {
  return reviewerVerdicts({ author: AUTHOR, comments, cited });
}

test('a reviewer\'s verdict line counts', () => {
  assert.deepEqual(counted([comment('memory 59ffd1cd: helped')]).counted.get('59ffd1cd'), [{ by: 'julian', verdict: 'helped' }]);
});

test('a verdict is read whatever its case, with spaces around it', () => {
  assert.deepEqual(counted([comment('  Memory 59FFD1CD : Not Sure  ')]).counted.get('59ffd1cd'), [{ by: 'julian', verdict: 'not sure' }]);
});

test('a verdict may put the id in backticks', () => {
  assert.equal(counted([comment('memory `59ffd1cd`: wrong')]).counted.get('59ffd1cd')[0].verdict, 'wrong');
});

test('a verdict is read from a comment written with Windows line endings', () => {
  assert.equal(counted([comment('Looks good.\r\nmemory 59ffd1cd: wrong\r\nthanks')]).counted.get('59ffd1cd')[0].verdict, 'wrong');
});

test('one comment may hold verdicts on several memories', () => {
  assert.deepEqual([...counted([comment('memory 59ffd1cd: helped\nmemory aaaaaaaa: wrong')]).counted.keys()], ['59ffd1cd', 'aaaaaaaa']);
});

test('a quoted verdict is not a verdict', () => {
  assert.equal(counted([comment('> memory 59ffd1cd: helped\nI disagree')]).counted.size, 0);
});

test('a verdict line followed by more words is not a verdict', () => {
  assert.equal(counted([comment('memory 59ffd1cd: helped a lot')]).counted.size, 0);
});

test('a comment without a body has no verdict', () => {
  assert.equal(counted([comment(null)]).counted.size, 0);
});

test('the author\'s verdict is ignored, with the reason', () => {
  assert.equal(counted([comment('memory 59ffd1cd: helped', { author: AUTHOR })]).ignored[0].why, "it was written by the pull request's author");
});

test('a bot\'s verdict is ignored', () => {
  assert.equal(counted([comment('memory 59ffd1cd: helped', { author: 'cursor', userType: 'Bot' })]).ignored[0].why, 'it was written by a bot');
});

test('a login ending in [bot] is a bot whatever its type says', () => {
  assert.equal(counted([comment('memory 59ffd1cd: helped', { author: 'mech-discovery[bot]' })]).ignored[0].why, 'it was written by a bot');
});

test('a verdict on a memory the pull request does not cite is ignored', () => {
  assert.deepEqual(counted([comment('memory dddddddd: wrong')]).ignored, [{ memory: 'dddddddd', verdict: 'wrong', by: 'julian', why: 'this pull request does not cite that memory' }]);
});

test('a comment whose writer GitHub no longer names has no verdict', () => {
  assert.equal(counted([comment('memory 59ffd1cd: helped', { author: null })]).counted.size, 0);
});

test('a reviewer\'s latest verdict replaces their earlier one', () => {
  const comments = [
    comment('memory 59ffd1cd: wrong', { createdAt: '2026-10-31T12:00:00Z' }),
    comment('memory 59ffd1cd: helped', { createdAt: '2026-10-31T09:00:00Z' }),
  ];
  assert.deepEqual(counted(comments).counted.get('59ffd1cd'), [{ by: 'julian', verdict: 'wrong' }]);
});

test('each reviewer\'s verdict is kept', () => {
  const comments = [comment('memory 59ffd1cd: helped'), comment('memory 59ffd1cd: wrong', { author: 'maria' })];
  assert.deepEqual(counted(comments).counted.get('59ffd1cd').map((verdict) => verdict.by), ['julian', 'maria']);
});

test('reviewers who agree settle the memory', () => {
  assert.equal(agreedVerdict([{ by: 'julian', verdict: 'helped' }, { by: 'maria', verdict: 'helped' }]), 'helped');
});

test('reviewers who disagree settle nothing', () => {
  assert.equal(agreedVerdict([{ by: 'julian', verdict: 'helped' }, { by: 'maria', verdict: 'not sure' }]), null);
});

test('no reviewer settles nothing', () => {
  assert.equal(agreedVerdict([]), null);
});
