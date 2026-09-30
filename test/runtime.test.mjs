import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../dist/snapshot.v1.json' with { type: 'json' };
import { createCatalogClient, validateModels } from '../runtime/index.js';

const row = (id = 'test/new-model', extra = {}) => ({ id, name: id, categories: ['chat'], billing_mode: 'paid', pricing: { input: 2, output: 8 }, ...extra });
const response = data => new Response(JSON.stringify({ data }));

test('offline startup uses bundled network overlay', async () => {
  const client = createCatalogClient({ network: 'solana', fetch: async () => { throw Error('offline'); } });
  const before = client.current();
  const after = await client.refresh();
  assert.equal(after.source, 'bundled');
  assert.deepEqual(after.models, before.models);
  assert.ok(!after.groups.flatMap(g => g.models).some(m => m.id === 'openai/o3'));
  assert.match(after.lastError, /offline/);
});
test('Base and Solana clients have separate membership', () => {
  const base = createCatalogClient({ network: 'base' }).current();
  const sol = createCatalogClient({ network: 'solana' }).current();
  assert.ok(base.groups.flatMap(g => g.models).some(m => m.id === 'openai/o3'));
  assert.ok(!sol.groups.flatMap(g => g.models).some(m => m.id === 'openai/o3'));
});
test('new model appears without policy edit; prices and removals follow refresh', async () => {
  let rows = [row()];
  const client = createCatalogClient({ fetch: async () => response(rows) });
  let state = await client.refresh();
  assert.ok(state.groups.flatMap(g => g.models).some(m => m.id === 'test/new-model'));
  assert.equal(state.pricing['test/new-model'].input, 2);
  rows = [row('test/replacement', { pricing: { input: 4, output: 9 } })];
  state = await client.refresh({ force: true });
  assert.equal(state.pricing['test/new-model'], undefined);
  assert.equal(state.pricing['test/replacement'].input, 4);
});
test('availability filters recommendations and shortcuts', async () => {
  const id = snapshot.picker_policy.views.default_chat.model_ids[0];
  const client = createCatalogClient({ fetch: async () => response([row(id, { available: false }), row()]) });
  const state = await client.refresh();
  assert.ok(!state.groups.flatMap(g => g.models).some(m => m.id === id));
  assert.ok(!Object.values(state.shortcuts).includes(id));
});
test('TTL and concurrent refreshes share one fetch', async () => {
  let calls = 0, clock = 100;
  const client = createCatalogClient({ ttlMs: 10, now: () => clock, fetch: async () => { calls++; return response([row()]); } });
  await Promise.all([client.refresh(), client.refresh(), client.refresh()]);
  await client.refresh(); assert.equal(calls, 1);
  clock = 111; await client.refresh(); assert.equal(calls, 2);
});
for (const [name, rows] of Object.entries({ empty: [], duplicate: [row(), row()], negative: [row('test/a', { pricing: { input: -1, output: 1 } })], missing: [row('test/a', { pricing: {} })], freePaid: [row('test/a', { billing_mode: 'free' })] })) {
  test(`malformed ${name} update preserves last good data`, async () => {
    let bad = false;
    const client = createCatalogClient({ fetch: async () => response(bad ? rows : [row()]) });
    await client.refresh(); bad = true;
    const after = await client.refresh({ force: true });
    assert.equal(after.source, 'live'); assert.ok(after.lastError);
    assert.equal(after.models[0].id, 'test/new-model');
  });
}
test('snapshot updates are atomic and use ETag', async () => {
  let version = 1, seenEtag, failGateway = false;
  const id = snapshot.picker_policy.views.default_chat.model_ids[0];
  const client = createCatalogClient({ catalogUrl: 'https://catalog.test/snapshot.json', fetch: async (url, init) => {
    if (String(url).includes('catalog.test')) {
      seenEtag = init.headers['If-None-Match'];
      if (version === 1 && seenEtag) return new Response(null, { status: 304 });
      const next = structuredClone(snapshot);
      next.catalog.catalog_version = next.picker_policy.catalog_version = next.router_policy.catalog_version = `2026.09.29.${version}`;
      next.picker_policy.views.default_chat.shortcuts.newalias = id;
      return new Response(JSON.stringify(next), { headers: { etag: `v${version}` } });
    }
    if (failGateway) throw Error('timeout');
    return response([row(id)]);
  } });
  assert.equal((await client.refresh()).shortcuts.newalias, id);
  await client.refresh({ force: true }); assert.equal(seenEtag, 'v1');
  version = 2; failGateway = true;
  assert.equal((await client.refresh({ force: true })).version, '2026.09.29.1');
  failGateway = false;
  assert.equal((await client.refresh({ force: true })).version, '2026.09.29.2');
});
test('media entries survive for media clients but never enter chat picker', async () => {
  const client = createCatalogClient({ fetch: async () => response([row('test/image', { categories: ['image'], billing_mode: 'per_image', pricing: { per_image: 0.1 } }), row()]) });
  const state = await client.refresh();
  assert.equal(state.models.length, 2);
  assert.deepEqual(state.groups.flatMap(g => g.models).map(m => m.id), ['test/new-model']);
});
test('non-namespaced public service IDs are accepted', () => {
  assert.equal(validateModels([row('openjev', { categories: ['judgment'], billing_mode: 'free', pricing: { per_call: 0 } })])[0].id, 'openjev');
});
