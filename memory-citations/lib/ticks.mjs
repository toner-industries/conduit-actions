// Decides which Helped and Wrong ticks count. A tick counts only when someone other than the pull
// request's author, and not a bot, set it: an author or agent must not grade its own citations.
// Who set a tick is read from the description's edit history (GitHub's userContentEdits, newest
// first, each holding the whole description after that edit). Anything that history cannot show is
// treated as not ticked, and the judge decides that memory instead.
import { readSection } from './section.mjs';

const BY_AUTHOR = "the pull request's author ticked it";
const BY_BOT = 'a bot ticked it';
const UNKNOWN = "the description's edit history does not show who ticked it";
const UNTICKED = { verdict: null, by: null, ignored: null };

/**
 * @param {{rows: Array<{memory: string, verdict: string|null}>,
 *   history: {author: string|null, edits: Array<{editor: {login: string, type: string}|null, body: string|null}>, complete: boolean}|null}}
 * @returns {Map<string, {verdict: string|null, by: string|null, ignored: {verdict: string, why: string}|null}>}
 */
export function countedTicks({ rows, history }) {
  return new Map(rows.map((row) => [row.memory, countedTick(row, history)]));
}

function countedTick(row, history) {
  if (row.verdict === null) return UNTICKED;
  const setters = history === null ? null : possibleSetters(row, history);
  const why = setters === null ? UNKNOWN : reasonToIgnore(setters, history.author);
  if (why !== null) return { verdict: null, by: null, ignored: { verdict: row.verdict, why } };
  return { verdict: row.verdict, by: [...new Set(setters.map((editor) => editor.login))].join(' or '), ignored: null };
}

/**
 * The edits that may have set the row's current tick, or null when that cannot be told. The tick was
 * set where the newest unbroken run of versions showing it begins; an edit whose text is gone may
 * hide that start, so it and the version after it are both possible.
 */
function possibleSetters(row, { author, edits, complete }) {
  if (edits.length === 0) return [{ login: author, type: 'User' }];
  const states = edits.map((edit) => (edit.body === null ? undefined : verdictIn(edit.body, row.memory)));
  if (states[0] !== undefined && states[0] !== row.verdict) return null;
  const changed = states.findIndex((state) => state !== undefined && state !== row.verdict);
  if (changed === -1 && !complete) return null;
  const oldest = changed === -1 ? edits.length - 1 : changed - 1;
  const setters = [];
  for (let index = 0; index <= oldest; index += 1) {
    const olderIsKnownSame = index < oldest && states[index + 1] === row.verdict;
    if (states[index] === undefined || !olderIsKnownSame) setters.push(edits[index].editor);
  }
  return setters;
}

function reasonToIgnore(setters, author) {
  const reasons = setters.map((editor) => {
    if (editor === null || !editor.login) return UNKNOWN;
    if (editor.type === 'Bot' || editor.login.endsWith('[bot]')) return BY_BOT;
    if (editor.login === author) return BY_AUTHOR;
    return null;
  });
  if (reasons.every((reason) => reason === null)) return null;
  return setters.length === 1 ? reasons[0] : UNKNOWN;
}

function verdictIn(body, memory) {
  const section = readSection(body);
  return section.state === 'rows' ? (section.rows.find((row) => row.memory === memory)?.verdict ?? null) : null;
}
