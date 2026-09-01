import { mkdir, writeFile } from "node:fs/promises";
import { readJson, sha256, stableJson, validateAll } from "./lib.mjs";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const [catalog, pickerPolicy, routerPolicy] = await Promise.all([
  readJson(new URL("source/catalog.json", root)),
  readJson(new URL("source/picker-policy.json", root)),
  readJson(new URL("source/router-policy.json", root)),
]);
const errors = validateAll(catalog, pickerPolicy, routerPolicy);
if (errors.length > 0) throw new Error(`refusing to build invalid catalog:\n${errors.join("\n")}`);

await mkdir(dist, { recursive: true });
const artifacts = {
  "catalog.v1.json": stableJson(catalog),
  "picker-policy.v1.json": stableJson(pickerPolicy),
  "router-policy.v1.json": stableJson(routerPolicy),
};
for (const [name, text] of Object.entries(artifacts)) {
  await writeFile(new URL(name, dist), text);
}
const manifest = {
  schema_version: 1,
  catalog_version: catalog.catalog_version,
  artifacts: Object.fromEntries(
    Object.entries(artifacts).map(([name, text]) => [name, { sha256: sha256(text), bytes: Buffer.byteLength(text) }]),
  ),
};
await writeFile(new URL("manifest.json", dist), stableJson(manifest));
console.log(`built ${Object.keys(artifacts).length} artifacts for catalog ${catalog.catalog_version}`);
