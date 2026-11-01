// Reads the "Memories used" section of a pull request description. The citation check and the
// merge judge both read it here, so a section that passes the check is the section the judge scores.
// The format is the one `recall.py cite` (toner-industries/claude-plugins, mech-memory) prints.

export const NO_MEMORIES_USED = 'No memories used.';
const UNDECIDED = '(fill in)';
const HEADING = /^##\s+memories used\s*$/i;
const NEXT_HEADING = /^#{1,2}\s/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const SEPARATOR_ROW = /^\|(\s*:?-+:?\s*\|)+\s*$/;
const MEMORY_ID = /^`?([0-9a-f]{8}(?:[0-9a-f-]{0,28}))`?$/;
const SEARCH_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// `meml-retrievals:` (one line, many ids) is what cite prints; `meml-retrieval:` markers and
// `Meml-Retrieval:` commit trailers are the older, one-id forms, still read so no search is lost.
const SEARCH_MARKER = /meml-retrievals?:((?:\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})+)/gi;
const COLUMNS = 3;
// Pull requests opened before verdict comments carry a fourth Reviewer column of tick boxes. It is
// read past and never as a verdict: nobody can tell who ticked a box (lib/verdicts.mjs).
const OLD_COLUMNS = 4;

/**
 * @returns {{state: 'missing'} | {state: 'none', problems: string[]} |
 *   {state: 'rows', rows: Array<{number: number, memory: string, says: string, decided: string}>, problems: string[]}}
 */
export function readSection(description) {
  const lines = sectionLines(description ?? '');
  if (lines === null) return { state: 'missing' };
  const content = lines.join('\n').replace(HTML_COMMENT, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const saysNone = content.includes(NO_MEMORIES_USED);
  const tableLines = content.filter((line) => line.startsWith('|') && !SEPARATOR_ROW.test(line) && !isHeaderRow(line));
  if (content.length === 0) {
    return { state: 'none', problems: [`The "Memories used" section is empty. Paste the output of recall.py cite, or write exactly "${NO_MEMORIES_USED}"`] };
  }
  if (saysNone && tableLines.length > 0) {
    return { state: 'rows', rows: [], problems: [`The "Memories used" section has both rows and "${NO_MEMORIES_USED}": keep one`] };
  }
  if (saysNone) return { state: 'none', problems: [] };
  const problems = [];
  const rows = tableLines.map((line, index) => readRow(line, index + 1, problems)).filter(Boolean);
  if (tableLines.length === 0) problems.push(`The "Memories used" section has no table rows. Paste the output of recall.py cite, or write exactly "${NO_MEMORIES_USED}"`);
  problems.push(...repeatedMemories(rows));
  return { state: 'rows', rows, problems };
}

/** Every search id named by the hidden line, older markers or commit trailers, in order, once each. */
export function searchIdsIn(texts) {
  const ids = [];
  for (const text of texts) {
    for (const marker of (text ?? '').matchAll(SEARCH_MARKER)) {
      for (const id of marker[1].toLowerCase().match(SEARCH_ID)) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function sectionLines(description) {
  const lines = description.split(/\r?\n/);
  const start = lines.findIndex((line) => HEADING.test(line.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => NEXT_HEADING.test(line.trim()));
  return end === -1 ? rest : rest.slice(0, end);
}

function isHeaderRow(line) {
  return /\|\s*memory\s*\|/i.test(line) && /what it decided/i.test(line);
}

function readRow(line, number, problems) {
  const cells = cellsOf(line);
  if (cells.length !== COLUMNS && cells.length !== OLD_COLUMNS) {
    problems.push(`Memories used, row ${number}: a row needs three columns (Memory, What it says, What it decided)`);
    return null;
  }
  const [memoryCell, says, decided] = cells;
  const memory = MEMORY_ID.exec(memoryCell)?.[1];
  if (memory === undefined) {
    problems.push(`Memories used, row ${number}: the Memory column must hold a memory id such as \`59ffd1cd\``);
    return null;
  }
  if (decided === '' || decided === UNDECIDED) {
    problems.push(`Memories used, row ${number} (memory ${memory}): fill in "What it decided", or remove the row if this memory did not drive a decision`);
  }
  return { number, memory, says, decided };
}

/** Splits on the table's pipes, keeping `\|` inside a cell. */
function cellsOf(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll('\\|', '|'));
}

function repeatedMemories(rows) {
  const seen = new Set();
  const repeated = new Set();
  for (const { memory } of rows) (seen.has(memory) ? repeated : seen).add(memory);
  return [...repeated].map((memory) => `Memories used: memory ${memory} is listed more than once; keep one row for it`);
}
