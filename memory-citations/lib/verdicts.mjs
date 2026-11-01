// Reads reviewers' verdicts on cited memories from the pull request's comments, review bodies and
// inline review comments. A verdict is a line of its own: `memory <8 hex>: helped|wrong|not sure`.
// It counts only when someone other than the pull request's author, and not a bot, wrote it, about a
// memory the pull request cites: an author or agent must not grade its own citations. Comments are
// used because GitHub names every comment's writer to any token, the workflow's own included.

const VERDICT_LINE = /^[ \t]*memory[ \t]+`?([0-9a-f]{8})`?[ \t]*:[ \t]*(helped|wrong|not sure)[ \t]*$/i;
const BY_AUTHOR = "it was written by the pull request's author";
const BY_BOT = 'it was written by a bot';
const NOT_CITED = 'this pull request does not cite that memory';

/**
 * @param {{author: string|null, comments: Array<{author: string|null, userType: string|null, createdAt: string, body: string|null}>,
 *   cited: string[]}} cited holds each cited memory's first eight characters.
 * @returns {{counted: Map<string, Array<{by: string, verdict: string}>>,
 *   ignored: Array<{memory: string, verdict: string, by: string, why: string}>}}
 *   counted holds, per memory, each reviewer's latest verdict.
 */
export function reviewerVerdicts({ author, comments, cited }) {
  const latest = new Map();
  const ignored = [];
  for (const { memory, verdict, by, userType } of oldestFirst(comments).flatMap(verdictsIn)) {
    const why = reasonToIgnore({ memory, by, userType }, author, cited);
    if (why !== null) ignored.push({ memory, verdict, by, why });
    else latestByReviewer(latest, memory).set(by, verdict);
  }
  const counted = new Map([...latest].map(([memory, byReviewer]) => [memory, [...byReviewer].map(([by, verdict]) => ({ by, verdict }))]));
  return { counted, ignored };
}

/** The verdict every reviewer gave, or null when there is none or any two differ. */
export function agreedVerdict(verdicts) {
  const distinct = new Set(verdicts.map((verdict) => verdict.verdict));
  return distinct.size === 1 ? [...distinct][0] : null;
}

/** A comment edited later keeps its created time, so its current text counts from when it was written. */
function oldestFirst(comments) {
  return [...comments].sort((one, other) => Date.parse(one.createdAt) - Date.parse(other.createdAt));
}

/** A comment whose writer GitHub no longer names (a deleted account) cannot be told from the author's. */
function verdictsIn(comment) {
  if (typeof comment.author !== 'string' || typeof comment.body !== 'string') return [];
  return comment.body.split(/\r?\n/).flatMap((line) => {
    const match = VERDICT_LINE.exec(line);
    if (match === null) return [];
    return [{ memory: match[1].toLowerCase(), verdict: match[2].toLowerCase(), by: comment.author, userType: comment.userType }];
  });
}

function reasonToIgnore({ memory, by, userType }, author, cited) {
  if (userType === 'Bot' || by.endsWith('[bot]')) return BY_BOT;
  if (by === author) return BY_AUTHOR;
  if (!cited.includes(memory)) return NOT_CITED;
  return null;
}

function latestByReviewer(latest, memory) {
  if (!latest.has(memory)) latest.set(memory, new Map());
  return latest.get(memory);
}
