// Appends a step output through GitHub Actions' file protocol; does nothing outside Actions.
import { appendFileSync } from 'node:fs';

export function writeGithubOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
}
