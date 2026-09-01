import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stableJson } from "./lib.mjs";

function argumentsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

function rows(body) {
  const data = body.data ?? body.models ?? body;
  if (!Array.isArray(data)) throw new Error("gateway response must contain data[] or models[]");
  return data;
}

function networkEntry(model) {
  return {
    listed: true,
    categories: [...new Set(model.categories ?? [])].sort(),
    billing_mode: model.billing_mode ?? "unknown",
    pricing: model.pricing ?? {},
    ...(Number.isInteger(model.context_window) && model.context_window > 0 ? { context_window: model.context_window } : {}),
    ...(Number.isInteger(model.max_output) && model.max_output > 0 ? { max_output: model.max_output } : {}),
  };
}

function absentNetworkEntry() {
  return { listed: false, categories: [], billing_mode: "unavailable", pricing: {} };
}

const args = argumentsOf(process.argv.slice(2));
for (const required of ["base", "solana", "version", "observed-at"]) {
  if (!args[required]) throw new Error(`--${required} is required`);
}
if (Number.isNaN(Date.parse(args["observed-at"]))) throw new Error("--observed-at must be an ISO date-time");

const baseBody = JSON.parse(await readFile(resolve(args.base), "utf8"));
const solanaBody = JSON.parse(await readFile(resolve(args.solana), "utf8"));
const base = new Map(rows(baseBody).map((model) => [model.id, model]));
const solana = new Map(rows(solanaBody).map((model) => [model.id, model]));
const ids = [...new Set([...base.keys(), ...solana.keys()])].sort();

const models = ids.map((id) => {
  const baseModel = base.get(id);
  const solanaModel = solana.get(id);
  const representative = baseModel ?? solanaModel;
  const baseEntry = baseModel ? networkEntry(baseModel) : absentNetworkEntry();
  const solanaEntry = solanaModel ? networkEntry(solanaModel) : absentNetworkEntry();
  return {
    id,
    name: representative.name ?? id,
    provider: representative.owned_by ?? representative.provider ?? id.split("/", 1)[0],
    description: representative.description ?? "",
    lifecycle: "active",
    declared_capabilities: [...new Set([...baseEntry.categories, ...solanaEntry.categories])].sort(),
    aliases: [],
    redirects: [],
    networks: { base: baseEntry, solana: solanaEntry },
  };
});

const catalog = {
  schema_version: 1,
  catalog_version: args.version,
  observed_at: new Date(args["observed-at"]).toISOString(),
  sources: {
    base: "https://blockrun.ai/api/v1/models?format=json",
    solana: "https://sol.blockrun.ai/api/v1/models?format=json",
  },
  models,
};

await writeFile(new URL("../source/catalog.json", import.meta.url), stableJson(catalog));
console.log(`imported ${models.length} models into source/catalog.json`);
