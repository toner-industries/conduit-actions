import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCitations } from '../check.mjs';
import { createEngine } from '../lib/engine.mjs';
import { fakeEngine } from './fake-engine.mjs';

const SEARCH = '07d47575-5244-424e-94da-81934b76cfc8';
const MEMORY = '59ffd1cd-0000-4000-8000-000000000001';
const KEY = 'test-only-key';

function description(rows = [`| \`59ffd1cd\` | Legacy ids are unique | kept ids unique | [ ] Helped [ ] Wrong [ ] Not sure |`], search = SEARCH) {
  return `## Memories used\n\n| Memory | What it says | What it decided | Reviewer |\n|---|---|---|---|\n${rows.join('\n')}\n\n<!-- meml-retrievals: ${search} -->\n`;
}

async function check(text, engineOptions = { searches: { [SEARCH]: [MEMORY] }, memories: [MEMORY] }, commits = []) {
  const fake = fakeEngine(engineOptions);
  const engine = createEngine({ url: 'https://engine.test', key: KEY, fetchImpl: fake.fetchImpl });
  return { result: await checkCitations({ description: text, commitMessages: commits, engine }), fake };
}

test('passes a filled-in row whose memory is in the store', async () => {
  assert.deepEqual((await check(description())).result, { passed: true, failures: [] });
});

test('passes "No memories used." without calling the engine', async () => {
  const { result, fake } = await check('## Memories used\n\nNo memories used.\n');
  assert.deepEqual({ passed: result.passed, calls: fake.requests.length }, { passed: true, calls: 0 });
});

test('fails a description without the section', async () => {
  assert.match((await check('## Summary\nx')).result.failures[0], /no "## Memories used" section/);
});

test('fails a row still to fill in, naming it', async () => {
  const { result } = await check(description(['| `59ffd1cd` | Legacy ids | (fill in) | [ ] Helped |']));
  assert.match(result.failures[0], /row 1 \(memory 59ffd1cd\)/);
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
