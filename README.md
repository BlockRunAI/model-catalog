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

## Runtime consumption (0.2.0 local pilot)

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

To update policy as well as model facts without shipping a new application,
serve the generated `dist/snapshot.v1.json` from a trusted HTTPS endpoint and
provide `catalogUrl`. The client validates the complete versioned snapshot,
uses ETag for that endpoint, and intersects its picker policy with the live
network catalog. Catalog/policy updates commit together only after the gateway
read also succeeds. A local HTTP endpoint is supported for integration tests.
There is no production snapshot hosting configured by this pilot.

Franklin's local adapter reads `BLOCKRUN_MODEL_CATALOG_URL` for this endpoint.
Its `RUNCODE_CHAIN` / session chain controls the network; the local Solana trial
uses `RUNCODE_CHAIN=solana`. `FRANKLIN_CATALOG_OFFLINE=1` is provided for
repeatable tests. The package link is currently `file:../model-catalog` and must
be replaced by a published dependency before a Franklin npm release.

## 2026-09-29 refresh

Catalog `2026.09.29.1` uses live Base/Solana public responses and ClawRouter
commit `9ab5b7c11352e39d79c6efdae390e8799ab88cc6` for recommendation order.
`source/provenance.json` records the counts and entries excluded from the Solana
chat view. ClawRouter `free/*` presentation IDs are resolved to actual gateway
IDs. Non-chat services (including `openjev`) remain in the complete catalog but
are excluded from the chat picker. Prices and per-network categories come from
the corresponding gateway, not ClawRouter's static table.
