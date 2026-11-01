// The merge judge, second half: posts each search's review outcome and writes the pull request comment.
//   1. Check the judge's scores: only memories it was asked about, each between 0 and 1.
//   2. Merge them with the reviewers' ticks (a tick always wins) and send one review outcome per search.
//   3. Write comment.md: every cited memory, its score and the reason, plus anything not scored.
// A search that already has a review outcome is refused by the engine and reported. Any other engine
// failure stops the job; a re-run then skips the searches already scored, which the engine refuses.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createEngine } from './lib/engine.mjs';
import { writeGithubOutput } from './lib/github-output.mjs';

const ALREADY_REVIEWED = 409;
const NO_EVIDENCE = 'the judge found no evidence either way';
const LONGEST_REASON = 200;
const SHORT_ID = 8;
export const COMMENT_MARKER = '<!-- meml-merge-judge -->';

export async function finishJudging({ prepared, judged, engine }) {
  const judgedScores = checkedJudgeScores(judged, prepared.toJudge);
  const scored = [...prepared.decided, ...judgedScores];
  const unscored = prepared.toJudge.filter((memory) => !judgedScores.some((score) => score.memoryId === memory.memoryId));
  const refusedSearches = await sendReviewOutcomes(scored, engine);
  return {
    sent: scored.filter((score) => !refusedSearches.includes(score.searchId)).length,
    comment: commentFor({ prepared, scored, unscored, refusedSearches }),
  };
}

function checkedJudgeScores(judged, toJudge) {
  if (!Array.isArray(judged?.scores)) throw new Error('the judge wrote no "scores" list');
  return judged.scores.map((score) => {
    const asked = toJudge.find((memory) => memory.memoryId === score?.memoryId);
    if (asked === undefined) throw new Error(`the judge scored ${String(score?.memoryId)}, which is not one this pull request cites for judging`);
    if (typeof score.reward !== 'number' || score.reward < 0 || score.reward > 1) {
      throw new Error(`the judge's score for ${asked.short} must be a number between 0 and 1`);
    }
    return { ...asked, reward: score.reward, reason: plainReason(score.reason), by: 'judge' };
  });
}

/** The judge read untrusted text: its reason goes into a table cell, one line, no pipes, bounded. */
function plainReason(reason) {
  const flat = String(reason ?? '').replace(/\s+/g, ' ').replaceAll('|', '/').trim();
  return flat.length > LONGEST_REASON ? `${flat.slice(0, LONGEST_REASON - 3)}...` : flat || 'no reason given';
}

async function sendReviewOutcomes(scored, engine) {
  const bySearch = new Map();
  for (const score of scored) bySearch.set(score.searchId, { ...bySearch.get(score.searchId), [score.memoryId]: score.reward });
  const refused = [];
  for (const [searchId, rewards] of bySearch) {
    const answer = await engine.reviewOutcome(searchId, rewards);
    if (answer.status === ALREADY_REVIEWED) refused.push(searchId);
    else if (answer.status !== 200) {
      const what = answer.status === 0 ? 'could not be reached' : `answered HTTP ${answer.status}`;
      throw new Error(`the memory engine ${what} for search ${searchId.slice(0, SHORT_ID)}; re-run this job`);
    }
  }
  return refused;
}

function commentFor({ prepared, scored, unscored, refusedSearches }) {
  const lines = [COMMENT_MARKER, '### Memory scores', ''];
  if (prepared.note) return [...lines, prepared.note, ''].join('\n');
  lines.push(
    prepared.retrievedOnly
      ? 'This pull request predates the "Memories used" section, so every memory its searches returned was judged from the review comments and the diff.'
      : "How the memories this pull request cites were scored at merge. A reviewer's tick decides; otherwise the judge read what each memory decided, the review comments and the diff.",
    '',
    '| Memory | Score | Reason |',
    '|---|---|---|',
  );
  for (const score of scored) {
    const refused = refusedSearches.includes(score.searchId);
    lines.push(`| \`${score.short}\` | ${refused ? 'not scored' : score.reward} | ${refused ? 'its search already had a review outcome' : score.reason} |`);
  }
  for (const memory of unscored) lines.push(`| \`${memory.short}\` | not scored | ${NO_EVIDENCE} |`);
  const notScored = [
    ...refusedSearches.map((id) => `search ${id.slice(0, SHORT_ID)} already had a review outcome, so its memories were not scored again`),
    ...prepared.skipped,
  ];
  if (notScored.length > 0) lines.push('', 'Not scored:', ...notScored.map((note) => `- ${note}`));
  const ignoredTicks = prepared.ignoredTicks ?? [];
  if (ignoredTicks.length > 0) {
    lines.push('', 'Ticks not counted:', ...ignoredTicks.map((tick) => `- memory ${tick.short}: ticked ${tick.verdict}, but ${tick.why}, so the judge decided`));
  }
  if (prepared.sectionProblems.length > 0) lines.push('', 'Notes on the section:', ...prepared.sectionProblems.map((note) => `- ${note}`));
  return [...lines, ''].join('\n');
}

async function main() {
  const workDir = process.env.WORK_DIR;
  const prepared = JSON.parse(readFileSync(join(workDir, 'prepared.json'), 'utf8'));
  const judgedPath = join(workDir, 'judged.json');
  if (prepared.toJudge.length > 0 && !existsSync(judgedPath)) throw new Error('the judge wrote no judged.json');
  const judged = prepared.toJudge.length > 0 ? JSON.parse(readFileSync(judgedPath, 'utf8')) : { scores: [] };
  const engine = createEngine({ url: process.env.MEMORY_ENGINE_URL, key: process.env.MEMORY_API_KEY });
  const { sent, comment } = await finishJudging({ prepared, judged, engine });
  writeFileSync(join(workDir, 'comment.md'), comment);
  writeGithubOutput('scored', sent);
  console.log(`${sent} memories scored as review outcomes`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=Memory judge::${error.message}`);
    process.exit(1);
  });
}
