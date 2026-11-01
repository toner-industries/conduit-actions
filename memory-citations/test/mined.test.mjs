import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMinedItems } from '../lib/mined.mjs';

// Ported from fluentstream/sms-delivery tests/meml-validate.test.mjs when mining moved into the shared merge judge.
test('a complete spo memory validates for ingest', () => {
  const result = validateMinedItems(
    [{ memoryType: 'spo', content: 'c', subject: 's', predicate: 'p', object: 'o' }],
    'source',
  );
  assert.equal(result.ok, true);
});

test('an ieu memory with no experience is rejected: the experience is the whole point of an ieu', () => {
  const result = validateMinedItems([{ memoryType: 'ieu', content: 'c' }], 'source');
  assert.equal(result.ok, false);
});

test('a partial spo triple (missing object) is rejected rather than ingested half-complete', () => {
  const result = validateMinedItems(
    [{ memoryType: 'spo', content: 'c', subject: 's', predicate: 'p' }],
    'source',
  );
  assert.equal(result.ok, false);
});

test('a mined item missing sourceKey inherits the run\'s default source', () => {
  const result = validateMinedItems([{ memoryType: 'spo', content: 'c' }], 'sms-harness pr-9');
  assert.equal(result.ok, true);
  assert.equal(result.items?.[0]?.sourceKey, 'sms-harness pr-9');
});

test('ingest input that is not a JSON array is rejected outright', () => {
  const result = validateMinedItems({ not: 'an array' }, 'source');
  assert.equal(result.ok, false);
});
