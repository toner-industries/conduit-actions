# conduit-actions

Public GitHub Actions plumbing owned by Toner Industries. This repo contains
no prompt or role content: it fetches Toner-managed role bundles at run
time over GitHub OIDC and stages them outside the checkout for the duration
of a job. The bundles themselves live in a private repo and are served by a
Cloudflare Worker that verifies each caller's identity via its GitHub OIDC
token.

## What's here

- `actions/prompt-relay/`: a composite action. Given a `role` name, it
  mints a short-lived GitHub OIDC token, exchanges it with the Toner prompt
  service for that role's file bundle, and writes the files under
  `$RUNNER_TEMP/conduit-prompts/` (outside the git checkout). It never
  echoes bundle content to the log.
- `.github/workflows/memory-citation-check.yml`: a reusable (`workflow_call`)
  workflow that checks a pull request's "Memories used" section. It passes
  only when the section exists, says exactly `No memories used.` or has
  "What it decided" filled in on every row, and every cited memory is in the
  repository's own memory store. If the memory engine cannot be asked, it
  fails as "could not verify"; re-run it.
- `.github/workflows/memory-merge-judge.yml`: a reusable workflow that, when a
  pull request merges, scores each cited memory (a Helped or Wrong tick
  decides when someone other than the author, and not a bot, set it, as the
  description's edit history shows; otherwise Claude judges from the decision,
  the comments and the diff), sends the scores as review outcomes, comments them on the pull
  request, and mines the pull request into new memories.
- `memory-citations/`: the scripts both workflows run, with their tests
  (`node --test memory-citations/test/`, no network).
- `.github/workflows/smoke.yml`: a `workflow_dispatch` smoke test that
  exercises the relay end-to-end against the `smoke` role and asserts a
  non-empty staged file, without printing its contents.

The automated pull request review (`role-pr-review.yml`) was removed on
2026-10-31: humans review, and the review instructions live on as the
mech-memory plugin's `review-pr` skill, run by hand.

## Using the memory workflows from a client repo

The repository's own memory key (a service key for its store) goes in a
repository secret. Make the `memory-citations` check required on the
protected branches, so no pull request merges without its citations checked.

```yaml
name: memory-citations
on:
  pull_request:
    types: [opened, synchronize, edited, reopened, closed]
  workflow_dispatch:
    inputs:
      pull_request:
        description: A merged pull request to score by hand (scores only, never mines)
        required: true
permissions:
  contents: read
  pull-requests: write
jobs:
  check:
    if: github.event_name == 'pull_request' && github.event.action != 'closed'
    uses: toner-industries/conduit-actions/.github/workflows/memory-citation-check.yml@<commit>
    secrets:
      memory_api_key: ${{ secrets.MEMORY_API_KEY }}
  judge:
    if: github.event_name == 'workflow_dispatch' || (github.event.action == 'closed' && github.event.pull_request.merged)
    uses: toner-industries/conduit-actions/.github/workflows/memory-merge-judge.yml@<commit>
    with:
      pull_request: ${{ inputs.pull_request }}
      mining_source: sms-harness
    secrets:
      memory_api_key: ${{ secrets.MEMORY_API_KEY }}
      anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
      mech_discovery_app_id: ${{ secrets.MECH_DISCOVERY_APP_ID }}
      mech_discovery_app_private_key: ${{ secrets.MECH_DISCOVERY_APP_PRIVATE_KEY }}
```

Run by hand (Actions, memory-citations, Run workflow, with a pull request number), the judge scores
one merged pull request and never mines it, so a pull request mined before is not mined twice. A
pull request from before citations, with search markers but no "Memories used" section, then has
every memory its searches returned judged; a normal merge never does that.

Pin both by commit, not by tag. Each workflow checks out `memory-citations/`
at a pinned commit of its own: to change the scripts, commit them, then point
the workflows' `ref:` lines at that commit in a second commit.

The pull request template section the check reads:

```markdown
## Memories used

<!-- Paste the output of `recall.py cite` (mech-memory plugin), fill in "What it decided"
for every row and remove rows that did not drive a decision. If no memory drove a
decision, replace the table with exactly: No memories used. A Helped or Wrong tick decides a
memory's score only when someone other than the author, and not a bot, set it. -->

| Memory | What it says | What it decided | Reviewer |
|---|---|---|---|
| `59ffd1cd` | Legacy ids must be unique per tenant | (fill in) | [ ] Helped [ ] Wrong [ ] Not sure |

<!-- meml-retrievals: <search id> <search id> -->
```

## Exposure model, stated honestly

Prompts are kept out of client repo contents, workflow logs, and build
artifacts. They necessarily exist in the runner's memory and local
filesystem for the duration of the job: that is unavoidable for any
process that has to read and act on them. Recovering them from a runner
requires deliberate tampering with that runner, and callers are gated by
the client-side workflow's CODEOWNERS, the prompt service's audit log, and
license/SOW terms. This is not a claim of cryptographic secrecy against
someone who controls the runner itself.

## Cleanup requirement for callers

The `prompt-relay` composite action stages files under
`$RUNNER_TEMP/conduit-prompts/` and does not clean them up itself , 
composite actions have no post-step mechanism. Every workflow that calls
`prompt-relay` MUST add a final step to remove that directory, so staged
files don't linger past the job:

```yaml
- name: cleanup staged prompts
  if: always()
  run: rm -rf "$RUNNER_TEMP/conduit-prompts"
```

`smoke.yml` in this repo already does this.

## Versioning

Releases are tagged `vX.Y.Z`, with a moving major tag (`v1`) kept pointed
at the latest compatible `v1.x` release. Client repos should pin to the
major tag (`@v1`) unless they have a specific reason to pin an exact
version.
