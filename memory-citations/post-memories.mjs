// The merge judge's mining ingest: checks what the mining pass extracted and stores it, 100 at a time.
// Ported from fluentstream/sms-delivery .github/scripts/meml-post-memories.mjs. A refused batch fails
// the step: an ingest that reports success on failure is worse than none, because nobody looks.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createEngine } from './lib/engine.mjs';
import { writeGithubOutput } from './lib/github-output.mjs';
import { validateMinedItems } from './lib/mined.mjs';

const BATCH_SIZE = 100;
const CREATED = 201;

export async function ingestMined({ mined, source, engine }) {
  const checked = validateMinedItems(mined, source);
  if (!checked.ok) throw new Error(`the mined memories failed validation: ${checked.errors.join('; ')}`);
  let ingested = 0;
  for (let start = 0; start < checked.items.length; start += BATCH_SIZE) {
    const batch = checked.items.slice(start, start + BATCH_SIZE);
    const answer = await engine.ingest(batch);
    if (answer.status !== CREATED) throw new Error(`the memory engine refused a batch after ${ingested} memories (HTTP ${answer.status})`);
    ingested += batch.length;
  }
  return ingested;
}

async function main() {
  const [minedFile, source] = process.argv.slice(2);
  if (!existsSync(minedFile)) {
    console.log('The mining step wrote nothing, so nothing was ingested.');
    writeGithubOutput('ingested', 0);
    return;
  }
  const engine = createEngine({ url: process.env.MEMORY_ENGINE_URL, key: process.env.MEMORY_API_KEY });
  const ingested = await ingestMined({ mined: JSON.parse(readFileSync(minedFile, 'utf8')), source, engine });
  writeGithubOutput('ingested', ingested);
  console.log(`${ingested} memories ingested`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error title=Memory mining::${error.message}`);
    process.exit(1);
  });
}
