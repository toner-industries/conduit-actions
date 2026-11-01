// The merge judge, first half: decides what a reviewer's tick already settles, and gathers the rest
// for Claude. Only memories cited in "Memories used" are ever scored; a fetched but uncited memory
// is left untouched.
//   1. Read the description and commit messages the workflow wrote (PR_FILE), and resolve every citation.
//   2. A ticked Helped is 1, a ticked Wrong is 0; everything else goes to the judge.
//   3. Write prepared.json (everything) and judge-input.json (only what the judge must read).
// An engine that cannot be asked stops the job: nothing is scored yet, so a re-run is safe.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from './lib/engine.mjs';
import { readPullRequest } from './lib/pull-request.mjs';
import { writeGithubOutput } from './lib/github-output.mjs';
import { resolveCitations } from './lib/resolve.mjs';
import { readSection, searchIdsIn } from './lib/section.mjs';

const TICKED = {
  helped: { reward: 1, reason: 'a reviewer ticked Helped' },
  wrong: { reward: 0, reason: 'a reviewer ticked Wrong' },
};

export async function prepareJudging({ description, commitMessages, engine }) {
  const section = readSection(description);
  if (section.state === 'missing') return nothingToScore('The description has no "Memories used" section, so no memory was scored.');
  if (section.state === 'none') return nothingToScore('The description says no memories were used, so none was scored.');
  const searchIds = searchIdsIn([description, ...commitMessages]);
  const { citations, failures } = await resolveCitations({ rows: section.rows, searchIds, engine });
  const temporary = failures.filter((failure) => failure.temporary);
  if (temporary.length > 0) throw new Error(temporary.map((failure) => failure.message).join('; '));
  const decided = [];
  const toJudge = [];
  for (const { row, memoryId, searchId, memory } of citations) {
    const cited = { memoryId, short: row.memory, searchId };
    if (row.verdict === null) toJudge.push({ ...cited, says: row.says, decided: row.decided, memory: memoryText(memory) });
    else decided.push({ ...cited, ...TICKED[row.verdict], by: 'reviewer' });
  }
  return { note: null, decided, toJudge, skipped: failures.map((failure) => failure.message), sectionProblems: section.problems };
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
  const prepared = await prepareJudging({ description, commitMessages, engine });
  writeFileSync(join(workDir, 'prepared.json'), JSON.stringify(prepared, null, 2));
  writeFileSync(join(workDir, 'judge-input.json'), JSON.stringify({ memories: prepared.toJudge }, null, 2));
  writeGithubOutput('to_judge', prepared.toJudge.length);
  writeGithubOutput('cited', prepared.decided.length + prepared.toJudge.length);
  console.log(prepared.note ?? `${prepared.decided.length} memories settled by a reviewer's tick, ${prepared.toJudge.length} for the judge, ${prepared.skipped.length} skipped`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=Memory judge::${error.message}`);
    process.exit(1);
  });
}
