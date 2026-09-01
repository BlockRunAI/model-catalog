# BlockRun Model Catalog

This repository is the source of truth for BlockRun's public model metadata
and the policies that project that metadata into model pickers and smart
routers.

## Ownership boundaries

- `source/catalog.json` owns model identity, lifecycle, public metadata, and
  per-network catalog overlays.
- `source/picker-policy.json` owns curated picker membership and order.
- `source/router-policy.json` owns model-specific routing policy. The routing
  algorithm remains in `@blockrun/router-core`.
- `dist/` is generated. Never edit it by hand.
- Provider credentials, deployment names, private upstream routing, wallet
  details, and customer data never belong in this repository.

## Commands

```bash
npm run validate
npm run build
npm test
npm run check
```

Bootstrap from saved gateway responses with:

```bash
node scripts/import-gateway.mjs \
  --base /path/to/base-models.json \
  --solana /path/to/solana-models.json \
  --version YYYY.MM.DD.N \
  --observed-at YYYY-MM-DDTHH:mm:ssZ
```

Run `npm run check` before committing. A model-list change must update the
catalog version and preserve every picker/router reference or intentionally
remove that reference in the same change.
