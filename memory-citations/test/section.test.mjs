import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSection, searchIdsIn } from '../lib/section.mjs';

const SEARCH = '07d47575-5244-424e-94da-81934b76cfc8';
const OTHER_SEARCH = 'f95ba721-d7a1-47fd-8698-1bcd0d1bb29b';
const HEADER = '| Memory | What it says | What it decided |\n|---|---|---|';
const OLD_HEADER = '| Memory | What it says | What it decided | Reviewer |\n|---|---|---|---|';

function body(rows, header = HEADER) {
  return `## Summary\nDid things.\n\n## Memories used\n\n${header}\n${rows.join('\n')}\n\n<!-- meml-retrievals: ${SEARCH} -->\n`;
}

function row(memory, decided = 'kept ids unique', says = 'Legacy ids are unique') {
  return `| \`${memory}\` | ${says} | ${decided} |`;
}

/** A row from before verdict comments, with a fourth Reviewer column of tick boxes. */
function oldRow(memory, ticks = '[x] Helped [ ] Wrong [ ] Not sure') {
  return `| \`${memory}\` | Legacy ids are unique | kept ids unique | ${ticks} |`;
}

test('a description without the section is reported missing', () => {
  assert.equal(readSection('## Summary\nnothing').state, 'missing');
});

test('the exact empty citation reads as none', () => {
  assert.equal(readSection('## Memories used\n\nNo memories used.\n').state, 'none');
});

test('an instruction comment inside the section is not content', () => {
  assert.equal(readSection('## Memories used\n<!-- paste recall.py cite here -->\nNo memories used.\n').state, 'none');
});

test('the section ends at the next level-two heading', () => {
  assert.equal(readSection('## Memories used\nNo memories used.\n## Testing\nran it').state, 'none');
});

test('the heading is matched whatever its case', () => {
  assert.equal(readSection('## memories USED\nNo memories used.').state, 'none');
});

test('an empty section is a problem', () => {
  assert.match(readSection('## Memories used\n\n## Testing\n').problems[0], /is empty/);
});

test('a filled-in row is read with its memory id and decision', () => {
  const section = readSection(body([row('59ffd1cd')]));
  assert.deepEqual(section.rows.map(({ memory, decided }) => ({ memory, decided })), [{ memory: '59ffd1cd', decided: 'kept ids unique' }]);
});

test('a row still reading (fill in) is a problem naming the row', () => {
  assert.match(readSection(body([row('59ffd1cd', '(fill in)')])).problems[0], /row 1 \(memory 59ffd1cd\).*What it decided/);
});

test('a row with an empty decision is a problem', () => {
  assert.equal(readSection(body([row('59ffd1cd', ' ')])).problems.length, 1);
});

test('a row without a memory id is a problem', () => {
  assert.match(readSection(body([row('not an id')])).problems[0], /row 1.*memory id/);
});

test('a row with too few columns is a problem', () => {
  assert.match(readSection(body(['| `59ffd1cd` | text |'])).problems[0], /row 1.*three columns/);
});

test('a row with too many columns is a problem', () => {
  assert.match(readSection(body(['| `59ffd1cd` | a | b | c | d |'])).problems[0], /row 1.*three columns/);
});

test('the same memory twice is a problem', () => {
  assert.match(readSection(body([row('59ffd1cd'), row('59ffd1cd')])).problems[0], /more than once/);
});

test('rows and "No memories used." together are a problem', () => {
  assert.match(readSection(body([row('59ffd1cd')]).replace('<!--', 'No memories used.\n<!--')).problems[0], /both/);
});

test('a pipe escaped inside a cell stays in the cell', () => {
  assert.equal(readSection(body([row('59ffd1cd', 'chose a \\| b')])).rows[0].decided, 'chose a | b');
});

test('an old row with a Reviewer column passes', () => {
  assert.deepEqual(readSection(body([oldRow('59ffd1cd')], OLD_HEADER)).problems, []);
});

test('an old row is read with its memory id and decision', () => {
  const [read] = readSection(body([oldRow('59ffd1cd')], OLD_HEADER)).rows;
  assert.deepEqual({ memory: read.memory, decided: read.decided }, { memory: '59ffd1cd', decided: 'kept ids unique' });
});

test('a tick in an old row is not read as a verdict', () => {
  assert.equal('verdict' in readSection(body([oldRow('59ffd1cd')], OLD_HEADER)).rows[0], false);
});

test('an old row still reading (fill in) is a problem', () => {
  const text = body([oldRow('59ffd1cd')], OLD_HEADER).replace('kept ids unique', '(fill in)');
  assert.match(readSection(text).problems[0], /What it decided/);
});

test('a full memory id is accepted', () => {
  assert.equal(readSection(body([row('59ffd1cd-0000-4000-8000-000000000001')])).rows[0].memory, '59ffd1cd-0000-4000-8000-000000000001');
});

test('search ids come from the hidden line', () => {
  assert.deepEqual(searchIdsIn([`<!-- meml-retrievals: ${SEARCH} ${OTHER_SEARCH} -->`]), [SEARCH, OTHER_SEARCH]);
});

test('search ids come from older markers and commit trailers too, once each', () => {
  assert.deepEqual(searchIdsIn([`<!-- meml-retrieval: ${SEARCH} -->`, `fix\n\nMeml-Retrieval: ${OTHER_SEARCH}\nMeml-Retrieval: ${SEARCH}`]), [SEARCH, OTHER_SEARCH]);
});

test('a marker followed by words is not read as an id', () => {
  assert.deepEqual(searchIdsIn(['meml-retrieval: none']), []);
});
