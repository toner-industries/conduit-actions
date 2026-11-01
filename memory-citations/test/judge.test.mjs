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

function row(id, ticks) {
  return `| \`${id.slice(0, 8)}\` | says ${id.slice(0, 8)} | decided ${id.slice(0, 8)} | ${ticks} |`;
}

const DESCRIPTION = `## Memories used

| Memory | What it says | What it decided | Reviewer |
|---|---|---|---|
${row(HELPED, '[x] Helped [ ] Wrong [ ] Not sure')}
${row(WRONG, '[ ] Helped [x] Wrong [ ] Not sure')}
${row(UNSURE, '[ ] Helped [ ] Wrong [x] Not sure')}

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

async function prepared(description = DESCRIPTION, overrides = {}) {
  const { fake, engine } = world(overrides);
  return { fake, engine, prepared: await prepareJudging({ description, commitMessages: [], engine }) };
}

function sentRewards(fake) {
  return Object.fromEntries(fake.requests.filter((r) => r.path === '/v1/feedback').map((r) => [r.body.retrievalId, r.body.rewards]));
}

test('a ticked Helped is scored 1 without asking the judge', async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(p.decided.find((d) => d.memoryId === HELPED).reward, 1);
});

test('a ticked Wrong is scored 0 without asking the judge', async () => {
  const { prepared: p } = await prepared();
  assert.deepEqual(p.decided.find((d) => d.memoryId === WRONG).reward, 0);
});

test('only an unticked or Not sure memory goes to the judge', async () => {
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

test('ticks win over the judge', async () => {
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
  assert.match(done.comment, /\| `aaaaaaaa` \| 1 \| a reviewer ticked Helped \|[\s\S]*\| `cccccccc` \| 0.7 \| useful background \|/);
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
