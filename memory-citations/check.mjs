// The citation check: passes only when the "Memories used" section is complete and every cited memory
// is verified in this repository's store. An engine that cannot be asked fails the check, never passes it.
//   1. Read the description and commit messages from the file the workflow wrote (PR_FILE).
//   2. Check the section's form, then resolve every cited memory through the engine.
//   3. Print each failure as a GitHub error annotation and exit 1 when any exists.
import { pathToFileURL } from 'node:url';
import { createEngine } from './lib/engine.mjs';
import { readPullRequest } from './lib/pull-request.mjs';
import { resolveCitations } from './lib/resolve.mjs';
import { NO_MEMORIES_USED, readSection, searchIdsIn } from './lib/section.mjs';

const MISSING_SECTION = `The description has no "## Memories used" section. Paste the output of recall.py cite, or add the heading followed by exactly "${NO_MEMORIES_USED}"`;

export async function checkCitations({ description, commitMessages, engine }) {
  const section = readSection(description);
  if (section.state === 'missing') return verdict([MISSING_SECTION]);
  if (section.problems.length > 0) return verdict(section.problems);
  if (section.state === 'none') return verdict([]);
  const searchIds = searchIdsIn([description, ...commitMessages]);
  const { failures } = await resolveCitations({ rows: section.rows, searchIds, engine });
  return verdict(failures.map((failure) => failure.message));
}

function verdict(failures) {
  return { passed: failures.length === 0, failures };
}

async function main() {
  const { description, commitMessages } = readPullRequest(process.env.PR_FILE);
  const engine = createEngine({ url: process.env.MEMORY_ENGINE_URL, key: process.env.MEMORY_API_KEY });
  const { passed, failures } = await checkCitations({ description, commitMessages, engine });
  for (const failure of failures) console.log(`::error title=Memories used::${failure}`);
  if (passed) console.log('Memories used: every citation checked out.');
  process.exit(passed ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=Memories used::could not run the check: ${error.message}`);
    process.exit(1);
  });
}
