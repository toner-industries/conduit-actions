# conduit-actions

Public GitHub Actions plumbing owned by Toner Industries. This repo contains
no prompt or role content — it fetches Toner-managed role bundles at run
time over GitHub OIDC and stages them outside the checkout for the duration
of a job. The bundles themselves live in a private repo and are served by a
Cloudflare Worker that verifies each caller's identity via its GitHub OIDC
token.

## What's here

- `actions/prompt-relay/` — a composite action. Given a `role` name, it
  mints a short-lived GitHub OIDC token, exchanges it with the Toner prompt
  service for that role's file bundle, and writes the files under
  `$RUNNER_TEMP/conduit-prompts/` (outside the git checkout). It never
  echoes bundle content to the log.
- `.github/workflows/role-pr-review.yml` — a reusable (`workflow_call`)
  workflow that runs a Claude-based PR review using the `pr-review` role
  bundle. Client repos call it with a short stub (below); they never see
  the review's house-layer instructions.
- `.github/workflows/smoke.yml` — a `workflow_dispatch` smoke test that
  exercises the relay end-to-end against the `smoke` role and asserts a
  non-empty staged file, without printing its contents.

## Using it from a client repo

A client repo wires the reusable workflow with a stub like this. The client
supplies its own Anthropic API key as a repo secret; that key is passed
straight through to the review job and never reaches any Toner service.

```yaml
name: pr-review
on:
  pull_request:
    types: [opened, synchronize]
permissions:
  contents: read
  pull-requests: write
  actions: read
  id-token: write   # required — mints the OIDC token the relay presents
jobs:
  review:
    uses: toner-industries/conduit-actions/.github/workflows/role-pr-review.yml@v1
    secrets:
      anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY_PR_REVIEW }}
```

`id-token: write` is for the prompt relay's OIDC exchange only — it is
unrelated to the review action's own `github_token`, which continues to be
the default `secrets.GITHUB_TOKEN`.

## Exposure model, stated honestly

Prompts are kept out of client repo contents, workflow logs, and build
artifacts. They necessarily exist in the runner's memory and local
filesystem for the duration of the job — that is unavoidable for any
process that has to read and act on them. Recovering them from a runner
requires deliberate tampering with that runner, and callers are gated by
the client-side workflow's CODEOWNERS, the prompt service's audit log, and
license/SOW terms. This is not a claim of cryptographic secrecy against
someone who controls the runner itself.

## Cleanup requirement for callers

The `prompt-relay` composite action stages files under
`$RUNNER_TEMP/conduit-prompts/` and does not clean them up itself —
composite actions have no post-step mechanism. Every workflow that calls
`prompt-relay` MUST add a final step to remove that directory, so staged
files don't linger past the job:

```yaml
- name: cleanup staged prompts
  if: always()
  run: rm -rf "$RUNNER_TEMP/conduit-prompts"
```

`role-pr-review.yml` and `smoke.yml` in this repo both already do this.

## Versioning

Releases are tagged `vX.Y.Z`, with a moving major tag (`v1`) kept pointed
at the latest compatible `v1.x` release. Client repos should pin to the
major tag (`@v1`) unless they have a specific reason to pin an exact
version.
