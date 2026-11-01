import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareJudging } from '../judge-input.mjs';
import { finishJudging } from '../post-outcome.mjs';
import { createEngine } from '../lib/engine.mjs';
import { fakeEngine } from './fake-engine.mjs';

const FIRST_SEARCH = '07d47575-5244-424e-94da-81934b76cfc8';
const SECOND_SEARCH = 'f95ba721-d7a1-47fd-8698-1bcd0d1bb29b';
const HELPED = 'aaaaaaaa-0000-4000-8000-000000000001';
const WRONG = 'bbbbbbbb-0000-4000-8000-000000000002';
const UNSURE = 'cccccccc-0000-4000-8000-000000000003';
const UNCITED = 'dddddddd-0000-4000-8000-000000000004';

function row(id) {
  return `| \`${id.slice(0, 8)}\` | says ${id.slice(0, 8)} | decided ${id.slice(0, 8)} |`;
}

const DESCRIPTION = `## Memories used

| Memory | What it says | What it decided |
|---|---|---|
${row(HELPED)}
${row(WRONG)}
${row(UNSURE)}

<!-- meml-retrievals: ${FIRST_SEARCH} ${SECOND_SEARCH} -->
`;

/** HELPED and UNCITED came from the first search; WRONG and UNSURE from the second, which also returned HELPED. */
function world(overrides = {}) {
  const fake = fakeEngine({
    searches: { [FIRST_SEARCH]: [HELPED, UNCITED], [SECOND_SEARCH]: [WRONG, UNSURE, HELPED] },
    memories: [HELPED, WRONG, UNSURE, UNCITED],
    ...overrides,
  });
  return { fake, engine: createEngine({ url: 'https://engine.test', key: 'test-only', fetchImpl: fake.fetchImpl }) };
}

const AUTHOR = 'agent-author';

function comment(body, author = 'julian', createdAt = '2026-10-31T10:00:00Z') {
  return { author, userType: 'User', createdAt, body };
}

function commentsBy(...comments) {
  return { author: AUTHOR, comments };
}

/** A reviewer, julian, gave a verdict on each cited memory in one comment. */
const REVIEWED = commentsBy(comment('Reviewed.\nmemory aaaaaaaa: helped\nmemory bbbbbbbb: wrong\nmemory cccccccc: not sure'));

async function prepared(description = DESCRIPTION, overrides = {}, reviews = REVIEWED) {
  const { fake, engine } = world(overrides);
  return { fake, engine, prepared: await prepareJudging({ description, commitMessages: [], engine, reviews }) };
}

function sentRewards(fake) {
  return Object.fromEntries(fake.requests.filter((r) => r.path === '/v1/feedback').map((r) => [r.body.retrievalId, r.body.rewards]));
}

test("a reviewer's helped is scored 1 without asking the judge", async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(p.decided.find((d) => d.memoryId === HELPED).reward, 1);
});

test("a reviewer's wrong is scored 0 without asking the judge", async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(p.decided.find((d) => d.memoryId === WRONG).reward, 0);
});

test('only a memory no reviewer settled goes to the judge', async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(p.toJudge.map((m) => m.memoryId), [UNSURE]);
});

test('the judge sees the memory, what the row says it decided, and its search', async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(
    { decided: p.toJudge[0].decided, content: p.toJudge[0].memory.content, search: p.toJudge[0].searchId },
    { decided: 'decided cccccccc', content: `text of ${UNSURE}`, search: SECOND_SEARCH },
  );
});

test('a memory two searches returned is credited once, to the first search listed', async () => {
  const { prepared: p, engine, fake } = await prepared();
  await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.deepEqual(Object.keys(sentRewards(fake)[FIRST_SEARCH]), [HELPED]);
});

test("a reviewer's verdict wins over the judge", async () => {
  const { prepared: p, engine, fake } = await prepared();
  await finishJudging({ prepared: p, judged: { scores: [{ memoryId: UNSURE, reward: 0.7, reason: 'background' }] }, engine });
  assert.deepEqual(sentRewards(fake)[SECOND_SEARCH], { [WRONG]: 0, [UNSURE]: 0.7 });
});

test('an uncited memory is never scored', async () => {
  const { prepared: p, engine, fake } = await prepared();
  await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.equal(JSON.stringify(sentRewards(fake)).includes(UNCITED), false);
});

test('scores are sent as review outcomes', async () => {
  const { prepared: p, engine, fake } = await prepared();
  await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.deepEqual([...new Set(fake.requests.filter((r) => r.path === '/v1/feedback').map((r) => r.body.kind))], ['review_outcome']);
});

test('a memory the judge left out is reported unscored', async () => {
  const { prepared: p, engine } = await prepared();
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /`cccccccc` \| not scored \| the judge found no evidence either way/);
});

test('the comment lists each memory with its score and reason', async () => {
  const { prepared: p, engine } = await prepared();
  const done = await finishJudging({ prepared: p, judged: { scores: [{ memoryId: UNSURE, reward: 0.7, reason: 'useful background' }] }, engine });
  assert.match(done.comment, /\| `aaaaaaaa` \| 1 \| Helped, decided by julian's comment \|[\s\S]*\| `cccccccc` \| 0.7 \| useful background \|/);
});

test('a search that already has a review outcome is reported, not scored again', async () => {
  const { prepared: p, engine, fake } = await prepared();
  fake.reviewed.add(SECOND_SEARCH);
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /search f95ba721 already had a review outcome/);
});

test('an engine failure while posting stops the job so it can be re-run', async () => {
  const { prepared: p, engine } = await prepared(DESCRIPTION, { status: { '/v1/feedback': 503 } });
  await assert.rejects(finishJudging({ prepared: p, judged: { scores: [] }, engine }), /HTTP 503.*re-run/);
});

test('a judge score for a memory it was not asked about is refused', async () => {
  const { prepared: p, engine } = await prepared();
  await assert.rejects(finishJudging({ prepared: p, judged: { scores: [{ memoryId: UNCITED, reward: 1, reason: 'x' }] }, engine }), /not one this pull request cites/);
});

test('a judge score outside 0 to 1 is refused', async () => {
  const { prepared: p, engine } = await prepared();
  await assert.rejects(finishJudging({ prepared: p, judged: { scores: [{ memoryId: UNSURE, reward: 2, reason: 'x' }] }, engine }), /between 0 and 1/);
});

test('no section means nothing to score, said plainly', async () => {
  const { prepared: p } = await prepared('## Summary\nx');
  assert.match(p.note, /no "Memories used" section/);
});

test('"No memories used." means nothing to score', async () => {
  const { prepared: p } = await prepared('## Memories used\n\nNo memories used.\n');
  assert.deepEqual({ decided: p.decided.length, toJudge: p.toJudge.length }, { decided: 0, toJudge: 0 });
});

test('a cited memory missing from the store is reported and skipped', async () => {
  const { prepared: p } = await prepared(DESCRIPTION, { memories: [HELPED, UNSURE] });
  assert.match(p.skipped.join('\n'), /memory bbbbbbbb is not in this repository's memory store/);
});

test('an unreachable engine stops the job so it can be re-run', async () => {
  await assert.rejects(prepared(DESCRIPTION, { status: { [`/v1/retrievals/${FIRST_SEARCH}`]: 'unreachable' } }), /could not be reached/);
});

test('a problem with the section is a note, not a memory left unscored', async () => {
  const text = DESCRIPTION.replace('decided cccccccc', '(fill in)');
  const { prepared: p, engine } = await prepared(text);
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /Notes on the section:\n- Memories used, row 3/);
});

test('a memory skipped for a lasting reason is listed as not scored', async () => {
  const { prepared: p, engine } = await prepared(DESCRIPTION, { memories: [HELPED, UNSURE] });
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /Not scored:\n- Memories used: memory bbbbbbbb is not in this repository's memory store/);
});

const OLD_STYLE = `## Summary\nDid things.\n\n<!-- meml-retrieval: ${FIRST_SEARCH} -->\n`;

async function preparedOldStyle(scoreRetrieved, overrides = {}) {
  const { fake, engine } = world(overrides);
  const p = await prepareJudging({ description: OLD_STYLE, commitMessages: [`fix\n\nMeml-Retrieval: ${SECOND_SEARCH}`], engine, scoreRetrieved });
  return { fake, engine, prepared: p };
}

test('an old pull request with only search markers scores nothing on a normal merge', async () => {
  const { prepared: p } = await preparedOldStyle(false);
  assert.match(p.note, /no "Memories used" section/);
});

test('a manual run sends every retrieved memory of an old pull request to the judge', async () => {
  const { prepared: p } = await preparedOldStyle(true);
  assert.deepEqual(p.toJudge.map((m) => m.memoryId).sort(), [HELPED, UNCITED, WRONG, UNSURE].sort());
});

test('a manual run credits a memory two searches returned to the first search only', async () => {
  const { prepared: p } = await preparedOldStyle(true);
  assert.equal(p.toJudge.find((m) => m.memoryId === HELPED).searchId, FIRST_SEARCH);
});

test('a manual run marks old-style memories as retrieved, not cited', async () => {
  const { prepared: p } = await preparedOldStyle(true);
  assert.deepEqual([...new Set(p.toJudge.map((m) => m.decided))], [null]);
});

test('a manual run skips a retrieved memory the store no longer holds', async () => {
  const { prepared: p } = await preparedOldStyle(true, { memories: [HELPED, WRONG, UNSURE] });
  assert.match(p.skipped.join('\n'), /memory dddddddd is not in this repository's memory store/);
});

test('a manual run of an old pull request posts its scores as review outcomes', async () => {
  const { prepared: p, engine, fake } = await preparedOldStyle(true);
  await finishJudging({ prepared: p, judged: { scores: [{ memoryId: UNCITED, reward: 1, reason: 'used' }] }, engine });
  assert.deepEqual(sentRewards(fake), { [FIRST_SEARCH]: { [UNCITED]: 1 } });
});

test('a manual run still prefers the section when there is one', async () => {
  const { engine } = world();
  const p = await prepareJudging({ description: DESCRIPTION, commitMessages: [], engine, reviews: REVIEWED, scoreRetrieved: true });
  assert.deepEqual(p.toJudge.map((m) => m.memoryId), [UNSURE]);
});

test('an old pull request with no markers at all scores nothing, even on a manual run', async () => {
  const { engine } = world();
  const p = await prepareJudging({ description: 'no markers', commitMessages: [], engine, scoreRetrieved: true });
  assert.match(p.note, /no search ids/);
});

test('the comment on an old pull request says its memories were retrieved, not cited', async () => {
  const { prepared: p, engine } = await preparedOldStyle(true);
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /predates the "Memories used" section/);
});

const BY_AUTHOR = commentsBy(comment('memory aaaaaaaa: helped\nmemory bbbbbbbb: wrong', AUTHOR));

test("the author's verdict does not decide: the judge does", async () => {
  const { prepared: p } = await prepared(DESCRIPTION, {}, BY_AUTHOR);
  assert.deepEqual(p.toJudge.map((m) => m.memoryId).sort(), [HELPED, WRONG, UNSURE].sort());
});

test("the comment says why the author's verdict was not counted", async () => {
  const { prepared: p, engine } = await prepared(DESCRIPTION, {}, BY_AUTHOR);
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /Verdicts not counted:\n- memory aaaaaaaa: agent-author said Helped, not counted because it was written by the pull request's author/);
});

test('with no verdict comments the judge decides every cited memory', async () => {
  const { prepared: p } = await prepared(DESCRIPTION, {}, commentsBy());
  assert.equal(p.decided.length, 0);
});

test('a verdict on a memory the pull request does not cite is reported, not scored', async () => {
  const { prepared: p, engine } = await prepared(DESCRIPTION, {}, commentsBy(comment('memory dddddddd: helped')));
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /- memory dddddddd: julian said Helped, not counted because this pull request does not cite that memory/);
});

test('reviewers who agree settle the memory together', async () => {
  const { prepared: p } = await prepared(DESCRIPTION, {}, commentsBy(comment('memory aaaaaaaa: helped'), comment('memory aaaaaaaa: helped', 'maria')));
  assert.equal(p.decided.find((d) => d.memoryId === HELPED).reason, "Helped, decided by julian's and maria's comments");
});

const DISAGREED = commentsBy(comment('memory aaaaaaaa: helped'), comment('memory aaaaaaaa: wrong', 'maria'));

test('reviewers who disagree leave the memory to the judge', async () => {
  const { prepared: p } = await prepared(DESCRIPTION, {}, DISAGREED);
  assert.deepEqual(p.toJudge.map((m) => m.memoryId).sort(), [HELPED, WRONG, UNSURE].sort());
});

test('the comment says the reviewers disagreed and names them', async () => {
  const { prepared: p, engine } = await prepared(DESCRIPTION, {}, DISAGREED);
  const done = await finishJudging({ prepared: p, judged: { scores: [] }, engine });
  assert.match(done.comment, /Reviewers disagreed:\n- memory aaaaaaaa: julian said Helped, maria said Wrong, so the judge decided/);
});

test("a reviewer's later verdict replaces their earlier one", async () => {
  const changedMind = commentsBy(comment('memory aaaaaaaa: wrong', 'julian', '2026-10-31T12:00:00Z'), comment('memory aaaaaaaa: helped', 'julian', '2026-10-31T09:00:00Z'));
  const { prepared: p } = await prepared(DESCRIPTION, {}, changedMind);
  assert.equal(p.decided.find((d) => d.memoryId === HELPED).reward, 0);
});

test('a tick in an old Reviewer column decides nothing', async () => {
  const old = DESCRIPTION.replace('| What it decided |\n|---|---|---|', '| What it decided | Reviewer |\n|---|---|---|---|')
    .replace(`decided aaaaaaaa |`, 'decided aaaaaaaa | [x] Helped [ ] Wrong [ ] Not sure |');
  const { prepared: p } = await prepared(old, {}, commentsBy());
  assert.deepEqual(p.toJudge.map((m) => m.memoryId).sort(), [HELPED, WRONG, UNSURE].sort());
});

test("a manual run of an old pull request takes a reviewer's verdict on a retrieved memory", async () => {
  const { engine } = world();
  const reviews = commentsBy(comment('memory dddddddd: helped'));
  const p = await prepareJudging({ description: OLD_STYLE, commitMessages: [], engine, reviews, scoreRetrieved: true });
  assert.equal(p.decided.find((d) => d.memoryId === UNCITED).reward, 1);
});
