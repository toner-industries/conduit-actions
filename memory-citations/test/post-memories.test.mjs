import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestMined } from '../post-memories.mjs';
import { createEngine } from '../lib/engine.mjs';

function engineAnswering(statuses = []) {
  const batches = [];
  const fetchImpl = async (_url, init) => {
    batches.push(JSON.parse(init.body));
    return Response.json({ ids: [] }, { status: statuses.shift() ?? 201 });
  };
  return { batches, engine: createEngine({ url: 'https://engine.test', key: 'test-only', fetchImpl }) };
}

const fact = (n) => ({ memoryType: 'spo', content: `fact ${n}` });

test('sends at most 100 memories per request', async () => {
  const { batches, engine } = engineAnswering();
  await ingestMined({ mined: Array.from({ length: 150 }, (_, n) => fact(n)), source: 'pr-1', engine });
  assert.deepEqual(batches.map((batch) => batch.length), [100, 50]);
});

test('gives memories without a source the pull request source', async () => {
  const { batches, engine } = engineAnswering();
  await ingestMined({ mined: [fact(1)], source: 'sms-delivery pr-12', engine });
  assert.equal(batches[0][0].sourceKey, 'sms-delivery pr-12');
});

test('counts what was ingested', async () => {
  const { engine } = engineAnswering();
  assert.equal(await ingestMined({ mined: [fact(1), fact(2)], source: 's', engine }), 2);
});

test('sends nothing when nothing was mined', async () => {
  const { batches, engine } = engineAnswering();
  await ingestMined({ mined: [], source: 's', engine });
  assert.equal(batches.length, 0);
});

test('refuses mined output that fails validation', async () => {
  const { engine } = engineAnswering();
  await assert.rejects(ingestMined({ mined: [{ memoryType: 'ieu', content: 'x' }], source: 's', engine }), /experience/);
});

test('fails when the engine refuses a batch', async () => {
  const { engine } = engineAnswering([500]);
  await assert.rejects(ingestMined({ mined: [fact(1)], source: 's', engine }), /HTTP 500/);
});
