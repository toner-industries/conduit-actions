// The merge judge, first half: decides what reviewers' verdict comments already settle, and gathers
// the rest for Claude. Only memories cited in "Memories used" are ever scored; a fetched but uncited
// memory is left untouched, except in a run started by hand for an older pull request with no section.
//   1. Read the description and commit messages (PR_FILE) and every comment (COMMENTS_FILE) the
//      workflow wrote, and resolve every citation.
//   2. Reviewers who agree settle a memory: helped is 1, wrong is 0 (lib/verdicts.mjs). Not sure,
//      disagreement or no verdict goes to the judge.
//   3. Write prepared.json (everything) and judge-input.json (only what the judge must read).
// An engine that cannot be asked stops the job: nothing is scored yet, so a re-run is safe.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from './lib/engine.mjs';
import { writeGithubOutput } from './lib/github-output.mjs';
import { readPullRequest, readReviewerComments } from './lib/pull-request.mjs';
import { resolveCitations, retrievedMemories } from './lib/resolve.mjs';
import { readSection, searchIdsIn } from './lib/section.mjs';
import { agreedVerdict, reviewerVerdicts } from './lib/verdicts.mjs';

const SHORT_ID = 8;
const LABEL = { helped: 'Helped', wrong: 'Wrong', 'not sure': 'Not sure' };
const REWARD = { helped: 1, wrong: 0 };
const NO_COMMENTS = { author: null, comments: [] };

export async function prepareJudging({ description, commitMessages, engine, reviews = NO_COMMENTS, scoreRetrieved = false }) {
  const section = readSection(description);
  if (section.state === 'missing' && scoreRetrieved) return prepareRetrieved(searchIdsIn([description, ...commitMessages]), engine, reviews);
  if (section.state === 'missing') return nothingToScore('The description has no "Memories used" section, so no memory was scored.');
  if (section.state === 'none') return nothingToScore('The description says no memories were used, so none was scored.');
  const searchIds = searchIdsIn([description, ...commitMessages]);
  const { citations, failures } = await resolveCitations({ rows: section.rows, searchIds, engine });
  failIfTemporary(failures);
  const memories = citations.map(({ row, memoryId, searchId, memory }) => ({
    cited: { memoryId, short: row.memory, searchId },
    forJudge: { says: row.says, decided: row.decided, memory: memoryText(memory) },
  }));
  return { note: null, ...settle(memories, reviews), skipped: failures.map((failure) => failure.message), sectionProblems: section.problems };
}

/**
 * Splits the memories into those reviewers settled and those the judge decides.
 * @param {Array<{cited: {memoryId, short, searchId}, forJudge: object}>} memories
 */
function settle(memories, reviews) {
  const { counted, ignored } = reviewerVerdicts({ ...reviews, cited: memories.map(({ cited }) => shortOf(cited)) });
  const decided = [];
  const toJudge = [];
  const disagreements = [];
  for (const { cited, forJudge } of memories) {
    const verdicts = counted.get(shortOf(cited)) ?? [];
    const agreed = agreedVerdict(verdicts);
    const reward = REWARD[agreed];
    if (reward !== undefined) decided.push({ ...cited, reward, reason: decidedBy(agreed, verdicts), by: 'reviewer' });
    else toJudge.push({ ...cited, ...forJudge });
    if (verdicts.length > 0 && agreed === null) disagreements.push({ short: cited.short, verdicts: verdicts.map(labelled) });
  }
  return { decided, toJudge, disagreements, ignoredVerdicts: ignored.map(labelled) };
}

/** A verdict names eight characters, so a memory cited by more of its id is matched on its first eight. */
function shortOf(cited) {
  return cited.short.slice(0, SHORT_ID);
}

function decidedBy(verdict, verdicts) {
  const owners = verdicts.map(({ by }) => `${by}'s`);
  const writers = owners.length === 1 ? `${owners[0]} comment` : `${owners.slice(0, -1).join(', ')} and ${owners.at(-1)} comments`;
  return `${LABEL[verdict]}, decided by ${writers}`;
}

function labelled(verdict) {
  return { ...verdict, verdict: LABEL[verdict.verdict] };
}

/**
 * A pull request from before citations, scored by hand: it names no memory, so every memory its
 * searches returned goes to the judge, as sms-delivery's memory-feedback.yml judged them. `decided`
 * is null because nobody said what each one decided.
 */
async function prepareRetrieved(searchIds, engine, reviews) {
  if (searchIds.length === 0) return nothingToScore('The description has no "Memories used" section and the pull request names no search ids, so no memory was scored.');
  const { memories, failures } = await retrievedMemories({ searchIds, engine });
  failIfTemporary(failures);
  const retrieved = memories.map(({ memory, ...cited }) => ({ cited, forJudge: { says: memory?.content ?? '', decided: null, memory: memoryText(memory) } }));
  return { note: null, ...settle(retrieved, reviews), skipped: failures.map((failure) => failure.message), sectionProblems: [], retrievedOnly: true };
}

function failIfTemporary(failures) {
  const temporary = failures.filter((failure) => failure.temporary);
  if (temporary.length > 0) throw new Error(temporary.map((failure) => failure.message).join('; '));
}

function nothingToScore(note) {
  return { note, decided: [], toJudge: [], skipped: [], sectionProblems: [] };
}

/** Only the fields that say what the memory claims; the judge needs nothing else. */
function memoryText(memory) {
  const { content, memoryType, subject, predicate, object, experience } = memory ?? {};
  return { content, memoryType, subject, predicate, object, experience };
}

async function main() {
  const workDir = process.env.WORK_DIR;
  const { description, commitMessages } = readPullRequest(process.env.PR_FILE);
  const engine = createEngine({ url: process.env.MEMORY_ENGINE_URL, key: process.env.MEMORY_API_KEY });
  // Set only by a run started by hand for an older merged pull request (memory-merge-judge.yml).
  const scoreRetrieved = process.env.SCORE_RETRIEVED_WITHOUT_SECTION === 'true';
  const reviews = readReviewerComments(process.env.COMMENTS_FILE);
  const prepared = await prepareJudging({ description, commitMessages, engine, reviews, scoreRetrieved });
  writeFileSync(join(workDir, 'prepared.json'), JSON.stringify(prepared, null, 2));
  // The author is named so the judge, reading every comment, does not follow the author's own verdict.
  writeFileSync(join(workDir, 'judge-input.json'), JSON.stringify({ author: reviews.author, memories: prepared.toJudge }, null, 2));
  writeGithubOutput('to_judge', prepared.toJudge.length);
  writeGithubOutput('cited', prepared.decided.length + prepared.toJudge.length);
  console.log(prepared.note ?? `${prepared.decided.length} memories settled by reviewers' verdict comments, ${prepared.toJudge.length} for the judge, ${prepared.skipped.length} skipped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=Memory judge::${error.message}`);
    process.exit(1);
  });
}
