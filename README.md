# @blockrun/model-catalog

Versioned model metadata and model-specific picker/router policy shared by
BlockRun gateways, products, and SDKs.

This repository is deliberately separate from the gateways and from
`@blockrun/router-core`:

- Gateways execute requests and own private upstream configuration.
- Router Core owns the deterministic routing algorithm.
- This repository owns public model facts and model-specific policy.

One catalog release can therefore be consumed by Base, Solana, Franklin,
ClawRouter, Hermes integrations, and the TypeScript/Python/Go SDKs without
copying model IDs between repositories.

## Layout

```text
source/catalog.json          canonical model facts + network overlays
source/picker-policy.json    shared picker membership and order
source/router-policy.json    model-specific router policy (currently draft)
schema/catalog.schema.json   portable JSON Schema for consumers
scripts/                     import, validation, and deterministic build tools
dist/                        generated release artifacts + integrity manifest
test/                        source/artifact invariants
```

`source/` is reviewed and committed. `dist/` is generated but also committed
so non-JavaScript consumers can pin a Git tag or release artifact without
running the toolchain.

## Update flow

1. Edit or import model facts in `source/catalog.json`.
2. Update picker/router references in the same change.
3. Increment `catalog_version`.
4. Run `npm run check`.
5. Publish an immutable Git tag and npm package/release artifacts.

Applications should prefer the live gateway catalog and cache by catalog
version/ETag. Bundled artifacts from this repository are the offline fallback,
not an excuse to ignore live availability.

## Network overlays

Base and Solana may intentionally expose different capabilities or prices for
the same model. Each model therefore has a `networks` object. Validation keeps
the global identity stable while preserving those differences for review.
Picker and router policies currently default to the Solana overlay; validation
rejects any policy model that is not listed as a Solana chat model. Consumers
may explicitly select the Base overlay for availability and pricing displays.

## Security boundary

Only public metadata belongs here. Do not add API keys, deployment names,
provider account details, private failover topology, wallet information, or
customer identifiers.

## Runtime consumption (0.2.0)

```js
import { createCatalogClient } from '@blockrun/model-catalog';
const catalog = createCatalogClient({ network: 'solana' });
const state = await catalog.refresh();
// state.groups, state.shortcuts, state.pricing, state.models
```

The client starts synchronously from the bundled snapshot and refreshes public
model facts from the selected gateway. Recommendations come from shared policy;
all other available chat models remain discoverable. Successful updates remove
unlisted models, and malformed/failed updates retain the last valid state.
Refreshes use a five-minute TTL, a four-second timeout and one in-flight request.
Base and Solana have separate clients/caches. Router policy remains draft and is
not executed by this client.

Model pickers can share `sortModelsNewestFirst(providerModels)`. Pass one
provider's models at a time; the helper returns a copy. When every model in the
group has a verified `release_date` (`YYYY-MM-DD`), it sorts by that date,
descending. With incomplete dates it compares numeric model generations
(6.1 before 6, 3.10 before 3.8), preserving input order for ties and models
with no recognized generation. This group-wide fallback keeps ordering
consistent when dated and undated models are mixed. Neither price, tier nor
alphabetical display names determine recency.

Browser code should import this helper from `@blockrun/model-catalog/ordering`.
That entry point contains only the sorter and release-date validator; it does
not load the runtime cache, bundled snapshot or Node.js validation dependencies.

The current gateways return the same compatibility `created` timestamp for
every model, so it must not be used as a release date. Unknown release dates
remain absent. Verified dates can be supplied by the gateway or the central
catalog; central dates also enrich live rows when the gateway omits them.

To update policy as well as model facts without shipping a new application,
serve the generated `dist/snapshot.v1.json` from a trusted HTTPS endpoint and
provide `catalogUrl`. The client validates the complete versioned snapshot,
uses ETag for that endpoint, and intersects its picker policy with the live
network catalog. Catalog/policy updates commit together only after the gateway
read also succeeds. A local HTTP endpoint is supported for integration tests.
The public current snapshot is available at:
`https://raw.githubusercontent.com/BlockRunAI/model-catalog/main/dist/snapshot.v1.json`.
Pin the runtime package to an immutable Git commit or release tag; the current
snapshot can advance independently after validated catalog changes merge.

Franklin's adapter supports `BLOCKRUN_MODEL_CATALOG_URL` for this endpoint.
Its wallet mode uses `RUNCODE_CHAIN` / the session chain. API account mode
uses the API gateway's own live catalog, with authentication handled only by
the product adapter. `FRANKLIN_CATALOG_OFFLINE=1` supports repeatable tests.
The package can be installed from a pinned GitHub archive without an npm
registry release. This package contains no payment signing or settlement code.

## 2026-10-20 refresh (4)

Catalog `2026.10.20.4` re-imports both rails and adds `google/gemini-4-argon`,
Google's frontier reasoning model, on Base and Solana (117 / 116 models):
$2/$10 per million tokens, Base cached input $0.10 (a 0.05x ratio, not
Gemini's usual 0.1x), 1M context, 65,536 max output, no long-context tier.
Google reprices it to $4/$20 (cache $0.20) on 2026-12-01; re-import after the
gateways move. Picker scope is deliberately catalog-only: a new
`gemini-4-argon` shortcut resolves to it, but it is not in the default chat
view or the Recommended group, and no existing shortcut (`gemini`, `gemini-3`)
moved. `nvidia/llama-3.2-11b-vision` and `poolside/laguna-xs-2.1` reported
`available: false` on Base at import time (free-tier health signal); they stay
listed.

## 2026-10-20 refresh (3)

Catalog `2026.10.20.3` re-imports both rails. Solana now lists
`deepseek/deepseek-v4.1-flash` (115 models), so the picker targets the
canonical id: the default chat view and its Recommended group list
`deepseek/deepseek-v4.1-flash` in place of `deepseek/deepseek-chat`, and the
`deepseek`, `deepseek-v4.1-flash`, `deepseek-v4`, `deepseek-v4-flash`, `dsv4`,
`deepseek-v3.2` and `deepseek-v3` shortcuts resolve to it. `deepseek-chat` keeps
resolving to the compatibility id. Base cached input for V4.1 Flash and its
compatibility ids drops from $0.028 to $0.006 per million tokens.
`nvidia/muse-glimmer-30b` and `poolside/laguna-xs-2.1` reported
`available: false` at import time (a live health signal for free upstreams);
they stay listed.

## 2026-10-20 refresh (2)

Catalog `2026.10.20.2` re-imports both rails and adds
`deepseek/deepseek-v4.1-flash`, the canonical id for DeepSeek V4.1 Flash.
Base lists it (116 models); Solana does not yet (114), and that is recorded
as-is. `deepseek/deepseek-chat` and `deepseek/deepseek-reasoner` remain as
compatibility ids for the same model, price, and routing. The Solana-scoped
picker cannot target a model that Solana does not list. Its new
`deepseek-v4.1-flash` shortcut, and the legacy `deepseek-v4`/`dsv4` shortcuts
that pointed at the retired `nvidia/deepseek-v4-flash`, therefore resolve to
`deepseek/deepseek-chat`. Retarget them to `deepseek/deepseek-v4.1-flash`
once Solana lists it.

## 2026-10-20 refresh

Catalog `2026.10.20.1` re-imports the live Base (115 models) and Solana (114)
public responses with `scripts/import-gateway.mjs`. It adds
`openai/gpt-6.1-sol` and `mistral/mistral-large-4`, and removes
`nvidia/gemma-4-31b` (delisted) and `openjev` (replaced by the Decisions API,
which is served at api.blockrun.ai and is no longer in the x402 model list).
The picker gains bare shortcuts for the two new chat models and drops the
`gemma-4-31b` shortcut; the ClawRouter recommendation order is unchanged.

## 2026-09-29 refresh

Catalog `2026.09.29.1` uses live Base/Solana public responses and ClawRouter
commit `9ab5b7c11352e39d79c6efdae390e8799ab88cc6` for recommendation order.
`source/provenance.json` records the counts and entries excluded from the Solana
chat view. ClawRouter `free/*` presentation IDs are resolved to actual gateway
IDs. Non-chat services remain in the complete catalog but are excluded from the
chat picker. Prices and per-network categories come from
the corresponding gateway, not ClawRouter's static table.
