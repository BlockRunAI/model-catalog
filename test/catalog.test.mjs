import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readJson, sha256, validateAll } from "../scripts/lib.mjs";

const root = new URL("../", import.meta.url);
const catalog = await readJson(new URL("source/catalog.json", root));
const pickerPolicy = await readJson(new URL("source/picker-policy.json", root));
const routerPolicy = await readJson(new URL("source/router-policy.json", root));

test("source catalog and policies satisfy cross-file invariants", () => {
  assert.deepEqual(validateAll(catalog, pickerPolicy, routerPolicy), []);
  assert.equal(catalog.models.length, 98);
});

test("network overlays preserve known Base and Solana differences", () => {
  const model = catalog.models.find((entry) => entry.id === "openai/o3");
  assert.ok(model);
  assert.equal(model.networks.base.categories.includes("chat"), true);
  assert.equal(model.networks.solana.categories.includes("chat"), false);
});

test("picker references only listed chat models", () => {
  const byId = new Map(catalog.models.map((model) => [model.id, model]));
  for (const id of pickerPolicy.views.default_chat.model_ids) {
    const model = byId.get(id);
    assert.ok(model, id);
    assert.equal(Object.values(model.networks).some((entry) => entry.listed && entry.categories.includes("chat")), true, id);
  }
});

test("router policy remains explicitly non-production during bootstrap", () => {
  assert.equal(routerPolicy.status, "draft");
});

test("manifest hashes match generated artifacts", async () => {
  const manifest = await readJson(new URL("dist/manifest.json", root));
  assert.equal(manifest.catalog_version, catalog.catalog_version);
  for (const [name, metadata] of Object.entries(manifest.artifacts)) {
    const text = await readFile(new URL(`dist/${name}`, root), "utf8");
    assert.equal(sha256(text), metadata.sha256, name);
    assert.equal(Buffer.byteLength(text), metadata.bytes, name);
  }
});
