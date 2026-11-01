import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCitations } from '../check.mjs';
import { createEngine } from '../lib/engine.mjs';
import { fakeEngine } from './fake-engine.mjs';

const SEARCH = '07d47575-5244-424e-94da-81934b76cfc8';
const MEMORY = '59ffd1cd-0000-4000-8000-000000000001';
const KEY = 'test-only-key';

const HEADER = '| Memory | What it says | What it decided |\n|---|---|---|';
const OLD_HEADER = '| Memory | What it says | What it decided | Reviewer |\n|---|---|---|---|';

function description(rows = ['| `59ffd1cd` | Legacy ids are unique | kept ids unique |'], header = HEADER) {
  return `## Memories used\n\n${header}\n${rows.join('\n')}\n\n<!-- meml-retrievals: ${SEARCH} -->\n`;
}

async function check(text, engineOptions = { searches: { [SEARCH]: [MEMORY] }, memories: [MEMORY] }, commits = []) {
  const fake = fakeEngine(engineOptions);
  const engine = createEngine({ url: 'https://engine.test', key: KEY, fetchImpl: fake.fetchImpl });
  return { result: await checkCitations({ description: text, commitMessages: commits, engine }), fake };
}

test('passes a filled-in row whose memory is in the store', async () => {
  assert.deepEqual((await check(description())).result.failures, []);
});

test('passes "No memories used." without calling the engine', async () => {
  const { result, fake } = await check('## Memories used\n\nNo memories used.\n');
  assert.deepEqual({ failures: result.failures, calls: fake.requests.length }, { failures: [], calls: 0 });
});

test('fails a description without the section', async () => {
  assert.match((await check('## Summary\nx')).result.failures[0], /no "## Memories used" section/);
});

test('fails a row still to fill in, naming it', async () => {
  const { result } = await check(description(['| `59ffd1cd` | Legacy ids | (fill in) |']));
  assert.match(result.failures[0], /row 1 \(memory 59ffd1cd\)/);
});

test('passes a pull request opened with the old Reviewer column', async () => {
  const row = '| `59ffd1cd` | Legacy ids are unique | kept ids unique | [ ] Helped [ ] Wrong [ ] Not sure |';
  assert.deepEqual((await check(description([row], OLD_HEADER))).result.failures, []);
});

test('fails an old row still to fill in', async () => {
  const row = '| `59ffd1cd` | Legacy ids are unique | (fill in) | [ ] Helped [ ] Wrong [ ] Not sure |';
  assert.match((await check(description([row], OLD_HEADER))).result.failures[0], /What it decided/);
});

test('fails rows with no search ids to look them up in', async () => {
  const text = description().replace(/<!--.*-->/, '');
  assert.match((await check(text)).result.failures[0], /meml-retrievals line/);
});

test('fails a search from another store, naming the store problem', async () => {
  const { result } = await check(description(), { searches: {}, memories: [MEMORY] });
  assert.match(result.failures[0], /search 07d47575 is not in this repository's memory store; check which key your session used/);
});

test('fails a memory none of the listed searches found', async () => {
  const { result } = await check(description(), { searches: { [SEARCH]: [] }, memories: [MEMORY] });
  assert.match(result.failures[0], /memory 59ffd1cd is not among the searches/);
});

test("fails a memory no longer in the repository's store", async () => {
  const { result } = await check(description(), { searches: { [SEARCH]: [MEMORY] }, memories: [] });
  assert.match(result.failures[0], /memory 59ffd1cd is not in this repository's memory store; check which key your session used/);
});

test('fails as could not verify when the engine cannot be reached', async () => {
  const { result } = await check(description(), { searches: {}, status: { [`/v1/retrievals/${SEARCH}`]: 'unreachable' } });
  assert.match(result.failures[0], /could not verify.*re-run/);
});

test('fails as could not verify on a server error', async () => {
  const { result } = await check(description(), { searches: {}, status: { [`/v1/retrievals/${SEARCH}`]: 503 } });
  assert.match(result.failures[0], /could not verify/);
});

test('fails as could not verify when the key is refused', async () => {
  const { result } = await check(description(), { searches: {}, status: { [`/v1/retrievals/${SEARCH}`]: 401 } });
  assert.match(result.failures[0], /memory key was refused/);
});

test('finds search ids in commit trailers too', async () => {
  const text = description().replace(/<!--.*-->/, '');
  assert.equal((await check(text, undefined, [`fix\n\nMeml-Retrieval: ${SEARCH}`])).result.passed, true);
});

test('sends the key as a bearer token', async () => {
  const { fake } = await check(description());
  assert.equal(fake.requests[0].authorization, `Bearer ${KEY}`);
});

test('fails an ambiguous short id', async () => {
  const twin = '59ffd1cd-0000-4000-8000-000000000002';
  const { result } = await check(description(), { searches: { [SEARCH]: [MEMORY, twin] }, memories: [MEMORY, twin] });
  assert.match(result.failures[0], /matches more than one memory/);
});

test('says plainly that nothing needed checking when no memories were used', async () => {
  const { result } = await check('## Memories used\n\nNo memories used.\n');
  assert.equal(result.summary, 'Memories used: the description says no memories were used, so there was nothing to check.');
});

test('says every citation checked out when rows pass', async () => {
  assert.equal((await check(description())).result.summary, 'Memories used: all 1 cited memories are in this repository\'s memory store.');
});
