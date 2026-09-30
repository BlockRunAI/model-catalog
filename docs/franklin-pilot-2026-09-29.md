# Franklin shared model catalog pilot — 2026-09-29

Status: local implementation and validation complete; no npm release, GitHub
push, production deployment, or paid inference was performed.

## Sources and scope

- Package: `@blockrun/model-catalog` 0.2.0; catalog `2026.09.29.1`.
- ClawRouter main: `9ab5b7c11352e39d79c6efdae390e8799ab88cc6`, committed
  2026-09-29T14:50:59Z. Its recommended order is filtered against actual
  network availability. Its `free/*` presentation aliases are resolved to
  gateway model IDs.
- Public Base/Solana model responses fetched on 2026-09-29. Union: 115 IDs;
  Solana: 113 entries, 79 chat models. Explicit `available: false` entries
  are excluded from the active network view.
- ClawRouter recommendation rows excluded from Solana chat: GPT-5.5 Pro,
  GPT-5.4 Pro, Tencent HY3, DeepSeek Reasoner. The first, second and fourth
  lack the Solana `chat` category; HY3 is absent.
- All currently available chat models remain discoverable, even if absent
  from the curated recommendation list. Media/service entries remain in
  the full catalog and do not enter the chat picker.

## What Franklin consumes

The existing local `file:../model-catalog` dependency now drives the Ink and
readline model pickers, active shortcuts, token price estimates, model listing
command and gateway-model helpers. Shared client refreshes use a five-minute
TTL, a four-second request deadline, concurrent fetch deduplication and an
in-memory last-good cache. Offline startup uses the bundled network snapshot.
The session network is respected; this does not change the user's wallet-chain
preference. Historical prices and explicit historical shortcut pins remain
readable for saved sessions.

`BLOCKRUN_MODEL_CATALOG_URL` optionally points to the centrally hosted
`dist/snapshot.v1.json`. This permits policy/version updates without an app
rebuild, using ETag and atomic snapshot validation. Without that setting, live
model facts refresh from the gateway and policy uses the bundled version.
There is no production snapshot hosting in this pilot. Auto routing's existing
algorithm and candidate policy have not been migrated; the new router policy
remains explicitly draft.

## Validation

| Check | Result |
| --- | --- |
| Catalog `npm run check` | 19 passed, 0 failed, 0 skipped |
| Franklin TypeScript build + asset copy | Passed |
| Franklin `npm test` | 460 passed, 0 failed, 0 skipped |
| Existing Router override local test | 1 passed |
| Live shared-client reads of Base and Solana | Passed |
| Offline `RUNCODE_CHAIN=solana franklin models` | 79 chat models listed |
| Workspace/trial source parity | 246 source/test/script files, zero mismatches |
| Package dry-run | Includes runtime, types, snapshot, manifest and validation helper |
| Git whitespace checks | Passed in both repositories |

The HTTP integration test is part of the 460 Franklin tests. It keeps one
Franklin process alive, changes only served catalog data, and verifies:

1. Newly added model appears in the existing picker array.
2. New alias resolves and price changes reach both picker and cost estimator.
3. A 503 retains the last valid catalog.
4. Removing the model removes its picker row, active alias and active price.
5. No Franklin build/package update occurs between these transitions.

The original pilot used a clean dependency install and compared the tested
source tree with the implementation. These results describe that pilot;
consumers must rerun their current branch's checks before release.

```sh
npm ci
npm test
RUNCODE_CHAIN=solana FRANKLIN_CATALOG_OFFLINE=1 node dist/index.js models
```

## Production follow-through

Publish the shared package, host the validated versioned snapshot at a trusted
HTTPS endpoint with a stable current-version URL, replace Franklin's local
file dependency, and configure the snapshot URL. Migrate ClawRouter and other
products to the same runtime/projection contract once. After that, ordinary
model-list and picker-policy changes require only a central catalog update;
new provider protocols or routing-algorithm changes can still require code
releases. Router policy promotion needs a separate routing/benchmark review.
