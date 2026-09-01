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

## Security boundary

Only public metadata belongs here. Do not add API keys, deployment names,
provider account details, private failover topology, wallet information, or
customer identifiers.
