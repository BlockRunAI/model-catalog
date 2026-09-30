import bundled from '../dist/snapshot.v1.json' with { type: 'json' };
import { validateAll } from '../scripts/lib.mjs';

const gateways = {
  solana: 'https://sol.blockrun.ai/api/v1/models?format=json',
  base: 'https://blockrun.ai/api/v1/models?format=json',
};
const isNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Reject the whole update on malformed data; never replace a good cache partially. */
export function validateModels(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty or malformed model catalog');
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+/-]*$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid or duplicate model ID');
    ids.add(row.id);
    if (typeof row.name !== 'string' || !row.name || !Array.isArray(row.categories) || !row.categories.every(x => typeof x === 'string')) throw new Error(`Invalid metadata: ${row.id}`);
    if (!row.pricing || typeof row.pricing !== 'object' || Array.isArray(row.pricing) || typeof row.billing_mode !== 'string') throw new Error(`Invalid pricing: ${row.id}`);
    if (row.billing_mode === 'paid' && (!isNumber(row.pricing.input) || !isNumber(row.pricing.output))) throw new Error(`Invalid token price: ${row.id}`);
    if (row.billing_mode === 'flat' && !isNumber(row.pricing.flat)) throw new Error(`Invalid flat price: ${row.id}`);
    if (row.billing_mode === 'free' && ((row.pricing.input ?? 0) !== 0 || (row.pricing.output ?? 0) !== 0)) throw new Error(`Nonzero free price: ${row.id}`);
    for (const key of ['context_window', 'max_output']) if (row[key] !== undefined && (!Number.isInteger(row[key]) || row[key] <= 0)) throw new Error(`Invalid ${key}: ${row.id}`);
  }
  return rows;
}

function validateSnapshot(value) {
  if (!value?.catalog || !value.picker_policy || !value.router_policy) throw new Error('Incomplete catalog snapshot');
  const errors = validateAll(value.catalog, value.picker_policy, value.router_policy);
  if (errors.length) throw new Error(errors.join('; '));
  return value;
}

function snapshotModels(snapshot, network) {
  return validateModels(snapshot.catalog.models.filter(m => ['active', 'preview'].includes(m.lifecycle) && m.networks[network]?.listed).map(m => ({
    id: m.id, name: m.name, owned_by: m.provider, description: m.description,
    ...m.networks[network],
  })));
}

/** Pure product-neutral projection. Uncurated models remain discoverable. */
export function projectCatalog(models, policy) {
  const chat = models.filter(m => m.categories.includes('chat') && m.available !== false);
  const byId = new Map(chat.map(m => [m.id, m]));
  const view = policy.views.default_chat;
  const used = new Set();
  const groups = (view.groups ?? []).map(group => ({
    id: group.id, title: group.title,
    models: group.model_ids.filter(id => byId.has(id) && !used.has(id) && used.add(id)).map(id => byId.get(id)),
  })).filter(group => group.models.length);
  const remaining = chat.filter(m => !used.has(m.id));
  const free = remaining.filter(m => m.billing_mode === 'free');
  const paid = remaining.filter(m => m.billing_mode !== 'free');
  if (free.length) {
    const group = groups.find(g => g.id === 'free');
    if (group) group.models.push(...free);
    else groups.push({ id: 'free', title: 'Free (no USDC needed)', models: free });
  }
  if (paid.length) groups.push({ id: 'other', title: 'All other available models', models: paid });
  const virtual = new Set(view.virtual_entries);
  const shortcuts = Object.fromEntries(Object.entries(view.shortcuts).filter(([, target]) => byId.has(target) || virtual.has(target)));
  for (const model of chat) {
    // Use the canonical ID as the unambiguous fallback in every picker.
    shortcuts[model.id] = model.id;
  }
  const pricing = Object.fromEntries(models.flatMap(m => {
    if (m.available === false) return [];
    if (m.billing_mode === 'free') return [[m.id, { input: 0, output: 0 }]];
    if (m.billing_mode === 'paid') return [[m.id, { input: m.pricing.input, output: m.pricing.output }]];
    if (m.billing_mode === 'flat') return [[m.id, { input: 0, output: 0, perCall: m.pricing.flat }]];
    return [];
  }));
  return { groups, shortcuts, pricing, virtualEntries: [...virtual] };
}

export function createCatalogClient(options = {}) {
  const network = options.network ?? 'solana';
  if (!(network in gateways)) throw new Error(`Unknown catalog network: ${network}`);
  let snapshot = validateSnapshot(options.snapshot ?? bundled);
  let models = snapshotModels(snapshot, network);
  let source = 'bundled';
  let lastError;
  let expiresAt = 0;
  let inflight;
  let etag;
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const listeners = new Set();
  const current = () => ({ network, version: snapshot.catalog.catalog_version, models, source, lastError, ...projectCatalog(models, snapshot.picker_policy) });
  async function json(url, headers = {}) {
    const response = await fetcher(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(options.timeoutMs ?? 4000) });
    if (response.status === 304) return { unchanged: true };
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    return { body: await response.json(), etag: response.headers.get('etag') };
  }
  return {
    current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh({ force = false } = {}) {
      if (inflight) return inflight;
      if (!force && now() < expiresAt) return Promise.resolve(current());
      inflight = (async () => {
        try {
          // Policy and gateway rows are fetched concurrently and independently:
          // an unreachable policy host must not cost clients the live gateway
          // catalog, it only keeps the last good policy.
          const [policy, gateway] = await Promise.allSettled([
            options.catalogUrl
              ? json(options.catalogUrl, etag ? { 'If-None-Match': etag } : {})
                .then(result => result.unchanged ? { snapshot, etag } : { snapshot: validateSnapshot(result.body), etag: result.etag })
              : Promise.resolve({ snapshot, etag }),
            json(options.gatewayUrl ?? gateways[network]),
          ]);
          if (gateway.status === 'rejected') throw gateway.reason;
          if (gateway.value.unchanged) throw new Error('Unexpected gateway 304');
          const nextModels = validateModels(gateway.value.body?.data).filter(m => m.available !== false);
          if (!nextModels.length) throw new Error('No available models');
          models = nextModels; source = 'live';
          if (policy.status === 'fulfilled') {
            snapshot = policy.value.snapshot; etag = policy.value.etag;
            lastError = undefined;
            expiresAt = now() + (options.ttlMs ?? 300000);
          } else {
            const reason = policy.reason;
            lastError = `Catalog policy: ${reason instanceof Error ? reason.message : String(reason)}`;
            expiresAt = now() + Math.min(options.ttlMs ?? 300000, 15000);
          }
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          // Short backoff on errors, retaining the last good snapshot.
          expiresAt = now() + Math.min(options.ttlMs ?? 300000, 15000);
        }
        const value = current();
        for (const listener of listeners) listener(value);
        return value;
      })().finally(() => { inflight = undefined; });
      return inflight;
    },
  };
}
