import test from 'node:test';
import assert from 'node:assert/strict';
import snapshot from '../dist/snapshot.v1.json' with { type: 'json' };
import { createCatalogClient, sortModelsNewestFirst, validateModels } from '../runtime/index.js';

const row = (id = 'test/new-model', extra = {}) => ({ id, name: id, categories: ['chat'], billing_mode: 'paid', pricing: { input: 2, output: 8 }, ...extra });
const response = data => new Response(JSON.stringify({ data }));

test('provider models sort by numeric generation, independent of labels, price and created', () => {
  for (const ids of [
    ['google/gemini-2.5-pro', 'google/gemini-3.1-pro', 'google/gemini-3.8-flash', 'google/gemini-3.10-flash', 'google/gemini-4-argon'],
    ['openai/gpt-4o', 'openai/gpt-4.1', 'openai/gpt-5.6-terra', 'openai/gpt-6-astra', 'openai/gpt-6.1-sol'],
    ['anthropic/claude-haiku-4.5', 'anthropic/claude-opus-4.8', 'anthropic/claude-fable-5.1', 'anthropic/claude-sonnet-5.5'],
    ['moonshot/kimi-k2.6', 'moonshot/kimi-k3', 'moonshot/kimi-k3.1-pro'],
    ['qwen/qwq-32b', 'qwen/qwen3.7-max', 'qwen/qwen3.8-flash'],
    ['xai/grok-3', 'xai/grok-4-1-fast-reasoning', 'xai/grok-4.7'],
    ['openai/gpt-4o', 'openai/o3', 'openai/gpt-5', 'openai/gpt-6.1-sol'],
  ]) {
    const input = ids.map((id, i) => row(id, { name: `Label ${i}`, created: 1700000000 }));
    assert.deepEqual(sortModelsNewestFirst(input).map(m => m.id), [...ids].reverse());
    assert.deepEqual(input.map(m => m.id), ids, 'caller input is unchanged');
  }
});

test('o-series reasoning models rank with their GPT-4 era peers, not as generation 3', () => {
  const ids = ['openai/gpt-5.4', 'openai/gpt-4.1', 'openai/o3', 'openai/o4-mini', 'openai/gpt-4o', 'openai/o1'];
  const shuffled = [ids[5], ids[2], ids[4], ids[1], ids[3], ids[0]].map(id => row(id));
  assert.deepEqual(sortModelsNewestFirst(shuffled).map(m => m.id), ['openai/gpt-5.4', 'openai/o3', 'openai/gpt-4.1', 'openai/o4-mini', 'openai/o1', 'openai/gpt-4o']);
});

test('complete verified release dates take precedence over model generations', () => {
  const input = [
    row('google/gemini-4-argon', { release_date: '2026-09-01' }),
    row('google/gemini-3.8-flash', { release_date: '2026-10-01' }),
  ];
  assert.deepEqual(sortModelsNewestFirst(input).map(m => m.id), [...input].reverse().map(m => m.id));
});

test('partial date coverage falls back consistently and generation ties preserve source order', () => {
  const input = [
    row('openai/gpt-5.6-sol', { release_date: '2026-10-10' }),
    row('openai/gpt-6-sol'),
    row('openai/gpt-6.1-sol', { release_date: '2026-09-01' }),
    row('openai/gpt-6.1-terra'),
  ];
  assert.deepEqual(sortModelsNewestFirst(input).map(m => m.id), [input[2], input[3], input[1], input[0]].map(m => m.id));
  assert.deepEqual(sortModelsNewestFirst([]), []);
});

test('verified central release dates enrich live rows without changing live prices', async () => {
  const dated = structuredClone(snapshot);
  const model = dated.catalog.models.find(m => m.networks.solana.listed && m.networks.solana.categories.includes('chat'));
  model.release_date = '2026-10-01';
  const client = createCatalogClient({ snapshot: dated, fetch: async () => response([row(model.id)]) });
  assert.equal(client.current().models.find(m => m.id === model.id).release_date, '2026-10-01');
  const live = await client.refresh();
  assert.equal(live.models[0].release_date, '2026-10-01');
  assert.equal(live.pricing[model.id].input, 2);
});

test('invalid release dates are rejected instead of becoming recency hints', () => {
  for (const release_date of ['2026-02-30', 'yesterday', '2026-1-1', 1700000000, null]) {
    assert.throws(() => validateModels([row('test/bad-date', { release_date })]), /release_date/);
  }
});

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
test('unreachable policy host still refreshes gateway rows and keeps last good policy', async () => {
  let policyDown = false, clock = 0;
  const id = snapshot.picker_policy.views.default_chat.model_ids[0];
  const client = createCatalogClient({ ttlMs: 60000, now: () => clock, catalogUrl: 'https://catalog.test/snapshot.json', fetch: async url => {
    if (String(url).includes('catalog.test')) {
      if (policyDown) throw Error('fetch failed');
      const next = structuredClone(snapshot);
      next.picker_policy.views.default_chat.shortcuts.newalias = id;
      return new Response(JSON.stringify(next), { headers: { etag: 'v1' } });
    }
    return response([row(id), row(policyDown ? 'test/after-outage' : 'test/before-outage')]);
  } });
  assert.equal((await client.refresh()).shortcuts.newalias, id);
  policyDown = true;
  const state = await client.refresh({ force: true });
  assert.equal(state.source, 'live');
  assert.match(state.lastError, /^Catalog policy: fetch failed/);
  assert.ok(state.models.some(m => m.id === 'test/after-outage'), 'gateway rows still refresh');
  assert.equal(state.shortcuts.newalias, id, 'last good policy retained');
  clock = 15001; policyDown = false;
  const recovered = await client.refresh();
  assert.equal(recovered.lastError, undefined, 'policy retried on short backoff');
});
test('cold start with unreachable policy host uses bundled policy with live gateway rows', async () => {
  const client = createCatalogClient({ catalogUrl: 'https://catalog.test/snapshot.json', fetch: async url => {
    if (String(url).includes('catalog.test')) throw Error('blocked');
    return response([row()]);
  } });
  const state = await client.refresh();
  assert.equal(state.source, 'live');
  assert.equal(state.version, snapshot.catalog.catalog_version);
  assert.deepEqual(state.models.map(m => m.id), ['test/new-model']);
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

for (const [name, corrupt] of Object.entries({
  missingView: p => { delete p.views.default_chat; },
  missingShortcuts: p => { delete p.views.default_chat.shortcuts; },
  nullShortcuts: p => { p.views.default_chat.shortcuts = null; },
  missingGroupModels: p => { delete p.views.default_chat.groups[0].model_ids; },
  nonArrayGroups: p => { p.views.default_chat.groups = {}; },
  invalidVirtualEntries: p => { p.views.default_chat.virtual_entries = 'blockrun/free'; },
})) {
  test(`malformed policy ${name} keeps last good policy and accepts live gateway updates`, async () => {
    let bad = false, seenEtag;
    const id = snapshot.picker_policy.views.default_chat.model_ids[0];
    const client = createCatalogClient({ catalogUrl: 'https://catalog.test/snapshot.json', fetch: async (url, init) => {
      if (String(url).includes('catalog.test')) {
        seenEtag = init.headers['If-None-Match'];
        const next = structuredClone(snapshot);
        next.picker_policy.views.default_chat.shortcuts.savedalias = id;
        if (bad) corrupt(next.picker_policy);
        return new Response(JSON.stringify(next), { headers: { etag: bad ? 'bad' : 'good' } });
      }
      return response([row(id), row(bad ? 'test/fresh' : 'test/old')]);
    } });
    await client.refresh();
    bad = true;
    const state = await client.refresh({ force: true });
    assert.match(state.lastError, /^Catalog policy:/);
    assert.equal(state.source, 'live');
    assert.equal(state.shortcuts.savedalias, id);
    assert.ok(state.models.some(m => m.id === 'test/fresh'));
    assert.deepEqual(client.current(), state, 'cached state remains readable');
    await client.refresh({ force: true });
    assert.equal(seenEtag, 'good', 'invalid policy does not advance ETag');
    bad = false;
    assert.equal((await client.refresh({ force: true })).lastError, undefined);
  });
}
