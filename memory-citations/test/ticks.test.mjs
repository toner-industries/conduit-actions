import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countedTicks } from '../lib/ticks.mjs';
import { readSection } from '../lib/section.mjs';

const AUTHOR = { login: 'agent-author', type: 'User' };
const REVIEWER = { login: 'julian', type: 'User' };
const BOT = { login: 'cursor', type: 'Bot' };

function body(ticks) {
  return `## Memories used\n\n| Memory | What it says | What it decided | Reviewer |\n|---|---|---|---|\n| \`59ffd1cd\` | says | decided | ${ticks} |\n`;
}
const OPEN = body('[ ] Helped [ ] Wrong [ ] Not sure');
const HELPED = body('[x] Helped [ ] Wrong [ ] Not sure');
const WRONG = body('[ ] Helped [x] Wrong [ ] Not sure');

/** Versions oldest first, as people make them; the history GitHub returns is newest first. */
function counted(versions, { author = AUTHOR.login, complete = true } = {}) {
  const edits = versions.map(([editor, text]) => ({ editor, body: text })).reverse();
  const rows = readSection(versions.at(-1)[1]).rows;
  return countedTicks({ rows, history: { author, edits, complete } }).get('59ffd1cd');
}

test('a reviewer\'s tick counts', () => {
  assert.deepEqual(counted([[AUTHOR, OPEN], [REVIEWER, HELPED]]), { verdict: 'helped', by: 'julian', ignored: null });
});

test('the author\'s tick is ignored', () => {
  assert.equal(counted([[AUTHOR, OPEN], [AUTHOR, HELPED]]).ignored.why, "the pull request's author ticked it");
});

test('a tick written when the pull request was opened is the author\'s', () => {
  assert.equal(counted([[AUTHOR, HELPED]]).verdict, null);
});

test('a bot\'s tick is ignored', () => {
  assert.equal(counted([[AUTHOR, OPEN], [BOT, WRONG]]).ignored.why, 'a bot ticked it');
});

test('a bot editing the description after a reviewer ticked leaves the reviewer\'s tick standing', () => {
  assert.equal(counted([[AUTHOR, OPEN], [REVIEWER, WRONG], [BOT, WRONG + '\nbot summary']]).by, 'julian');
});

test('the author re-ticking after a reviewer is the author\'s tick', () => {
  assert.equal(counted([[AUTHOR, OPEN], [REVIEWER, WRONG], [AUTHOR, HELPED]]).ignored.why, "the pull request's author ticked it");
});

test('a description never edited has no counted tick', () => {
  const rows = readSection(HELPED).rows;
  assert.equal(countedTicks({ rows, history: { author: AUTHOR.login, edits: [], complete: true } }).get('59ffd1cd').ignored.why, "the pull request's author ticked it");
});

test('a tick older than the history GitHub returned cannot be attributed', () => {
  assert.equal(counted([[REVIEWER, HELPED], [AUTHOR, HELPED + ' ']], { complete: false }).ignored.why, "the description's edit history does not show who ticked it");
});

test('an edit whose text GitHub no longer shows cannot be attributed', () => {
  assert.equal(counted([[AUTHOR, OPEN], [REVIEWER, null], [REVIEWER, HELPED]]).by, 'julian');
});

test('a tick made in an edit whose text is gone cannot be attributed', () => {
  assert.equal(counted([[AUTHOR, OPEN], [REVIEWER, null], [BOT, HELPED]]).ignored.why, "the description's edit history does not show who ticked it");
});

test('an editor GitHub no longer names cannot be attributed', () => {
  assert.equal(counted([[AUTHOR, OPEN], [null, HELPED]]).ignored.why, "the description's edit history does not show who ticked it");
});

test('no edit history at all means no tick counts', () => {
  const rows = readSection(HELPED).rows;
  assert.equal(countedTicks({ rows, history: null }).get('59ffd1cd').ignored.why, "the description's edit history does not show who ticked it");
});

test('the history must end at the description being judged', () => {
  const rows = readSection(HELPED).rows;
  const history = { author: AUTHOR.login, edits: [{ editor: REVIEWER, body: OPEN }, { editor: AUTHOR, body: OPEN }], complete: true };
  assert.equal(countedTicks({ rows, history }).get('59ffd1cd').ignored.why, "the description's edit history does not show who ticked it");
});

test('an unticked row has nothing to count', () => {
  assert.deepEqual(counted([[AUTHOR, OPEN]]), { verdict: null, by: null, ignored: null });
});
