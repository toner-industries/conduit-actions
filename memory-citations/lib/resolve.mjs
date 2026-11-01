// Turns each cited short id into the one full memory id the listed searches returned, and checks it is
// still in the repository's store. The citation check and the merge judge resolve citations the same way.
import { isRefusedKey } from './engine.mjs';

const SHORT_ID = 8;
const NOT_FOUND = 404;

/**
 * @returns {Promise<{citations: Array<{row: object, memoryId: string, searchId: string, memory: object}>,
 *   failures: Array<{message: string, temporary: boolean}>}>}
 * Any failure means the citations could not all be verified; callers must never treat that as a pass.
 * A temporary failure (engine unreachable, key refused) says nothing about the citation itself.
 */
export async function resolveCitations({ rows, searchIds, engine }) {
  if (rows.length === 0) return { citations: [], failures: [] };
  if (searchIds.length === 0) {
    return { citations: [], failures: [lasting('Memories used: no search ids found. Keep the hidden meml-retrievals line that recall.py cite prints')] };
  }
  const found = await searchesFound(searchIds, engine);
  if (found.failures.length > 0) return { citations: [], failures: found.failures };
  const citations = [];
  const failures = [];
  for (const row of rows) {
    const outcome = await resolveRow(row, found.searches, engine);
    if (outcome.failure) failures.push(outcome.failure);
    else citations.push(outcome.citation);
  }
  return { citations, failures };
}

/**
 * Every memory the searches returned, each once, credited to the first search listed that returned it.
 * Only for an older pull request scored by hand: it has search markers but no "Memories used" section.
 */
export async function retrievedMemories({ searchIds, engine }) {
  const searches = [];
  const failures = [];
  for (const id of searchIds) {
    const answer = await engine.search(id);
    if (answer.status === 200 && Array.isArray(answer.body?.memoryIds)) searches.push({ id, memoryIds: answer.body.memoryIds });
    else failures.push(searchFailure(id, answer.status));
  }
  const memories = [];
  const seen = new Set();
  for (const search of searches) {
    for (const memoryId of search.memoryIds.filter((id) => !seen.has(id))) {
      seen.add(memoryId);
      const answer = await engine.memory(memoryId);
      const short = memoryId.slice(0, SHORT_ID);
      if (answer.status === 200) memories.push({ memoryId, short, searchId: search.id, memory: answer.body });
      else if (answer.status === NOT_FOUND) failures.push(lasting(`Memories used: memory ${short} is not in this repository's memory store; check which key your session used`));
      else failures.push(couldNotVerify(answer.status));
    }
  }
  return { memories, failures };
}

async function searchesFound(searchIds, engine) {
  const searches = [];
  const failures = [];
  for (const id of searchIds) {
    const answer = await engine.search(id);
    if (answer.status === 200 && Array.isArray(answer.body?.memoryIds)) searches.push({ id, memoryIds: answer.body.memoryIds });
    else failures.push(searchFailure(id, answer.status));
  }
  return { searches, failures };
}

function searchFailure(id, status) {
  const short = id.slice(0, SHORT_ID);
  if (status === NOT_FOUND) return lasting(`Memories used: search ${short} is not in this repository's memory store; check which key your session used`);
  return couldNotVerify(status);
}

async function resolveRow(row, searches, engine) {
  const matches = [...new Set(searches.flatMap((search) => search.memoryIds).filter((id) => id.startsWith(row.memory)))];
  if (matches.length === 0) {
    return { failure: lasting(`Memories used: memory ${row.memory} is not among the searches the meml-retrievals line lists; add the search that found it, or check which key your session used`) };
  }
  if (matches.length > 1) return { failure: lasting(`Memories used: memory ${row.memory} matches more than one memory; use more of its id`) };
  const [memoryId] = matches;
  const answer = await engine.memory(memoryId);
  if (answer.status === NOT_FOUND) {
    return { failure: lasting(`Memories used: memory ${row.memory} is not in this repository's memory store; check which key your session used`) };
  }
  if (answer.status !== 200) return { failure: couldNotVerify(answer.status) };
  const searchId = searches.find((search) => search.memoryIds.includes(memoryId)).id;
  return { citation: { row, memoryId, searchId, memory: answer.body } };
}

function couldNotVerify(status) {
  if (isRefusedKey(status)) {
    return temporary(`Memories used: could not verify, the repository's memory key was refused (HTTP ${status}); fix the memory_api_key secret, then re-run`);
  }
  const what = status === 0 ? 'the memory engine could not be reached' : `the memory engine answered HTTP ${status}`;
  return temporary(`Memories used: could not verify, ${what}; re-run`);
}

function lasting(message) {
  return { message, temporary: false };
}

function temporary(message) {
  return { message, temporary: true };
}
