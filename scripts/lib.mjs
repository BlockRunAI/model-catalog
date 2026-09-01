import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function validateAll(catalog, pickerPolicy, routerPolicy) {
  const errors = [];
  if (catalog.schema_version !== 1) errors.push("catalog.schema_version must be 1");
  if (!/^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/.test(catalog.catalog_version ?? "")) {
    errors.push("catalog.catalog_version must use YYYY.MM.DD.N");
  }
  if (Number.isNaN(Date.parse(catalog.observed_at))) errors.push("catalog.observed_at must be an ISO date-time");
  if (!Array.isArray(catalog.models) || catalog.models.length === 0) errors.push("catalog.models must be non-empty");

  const ids = new Set();
  const aliases = new Set();
  for (const [index, model] of (catalog.models ?? []).entries()) {
    const at = `catalog.models[${index}]`;
    if (typeof model.id !== "string" || !model.id.includes("/")) errors.push(`${at}.id must be namespaced`);
    if (ids.has(model.id)) errors.push(`duplicate model id: ${model.id}`);
    ids.add(model.id);
    if (typeof model.name !== "string" || model.name.length === 0) errors.push(`${at}.name must be non-empty`);
    if (!["active", "preview", "deprecated", "sunset"].includes(model.lifecycle)) errors.push(`${at}.lifecycle is invalid`);
    if (!Array.isArray(model.declared_capabilities)) errors.push(`${at}.declared_capabilities must be an array`);
    for (const network of ["base", "solana"]) {
      const entry = model.networks?.[network];
      if (!entry) {
        errors.push(`${at}.networks.${network} is required`);
        continue;
      }
      if (!Array.isArray(entry.categories)) errors.push(`${at}.networks.${network}.categories must be an array`);
      if (typeof entry.billing_mode !== "string" || entry.billing_mode.length === 0) errors.push(`${at}.networks.${network}.billing_mode is required`);
      if (typeof entry.pricing !== "object" || entry.pricing === null || Array.isArray(entry.pricing)) errors.push(`${at}.networks.${network}.pricing must be an object`);
    }
    for (const alias of model.aliases ?? []) {
      if (aliases.has(alias)) errors.push(`duplicate alias: ${alias}`);
      if (ids.has(alias)) errors.push(`alias collides with model id: ${alias}`);
      aliases.add(alias);
    }
  }

  for (const model of catalog.models ?? []) {
    for (const target of model.redirects ?? []) {
      if (!ids.has(target)) errors.push(`${model.id} redirects to missing model ${target}`);
      if (target === model.id) errors.push(`${model.id} redirects to itself`);
    }
  }

  for (const [name, view] of Object.entries(pickerPolicy.views ?? {})) {
    const seen = new Set();
    for (const id of view.model_ids ?? []) {
      if (!ids.has(id)) errors.push(`picker view ${name} references missing model ${id}`);
      if (seen.has(id)) errors.push(`picker view ${name} repeats ${id}`);
      seen.add(id);
      const model = (catalog.models ?? []).find((candidate) => candidate.id === id);
      if (model && !Object.values(model.networks).some((entry) => entry.listed && entry.categories.includes("chat"))) {
        errors.push(`picker view ${name} references non-chat model ${id}`);
      }
    }
  }

  for (const [name, candidates] of Object.entries(routerPolicy.candidate_sets ?? {})) {
    const seen = new Set();
    for (const id of candidates) {
      if (!ids.has(id)) errors.push(`router candidate set ${name} references missing model ${id}`);
      if (seen.has(id)) errors.push(`router candidate set ${name} repeats ${id}`);
      seen.add(id);
    }
  }

  for (const [name, policy] of [["picker", pickerPolicy], ["router", routerPolicy]]) {
    if (policy.schema_version !== 1) errors.push(`${name} policy schema_version must be 1`);
    if (policy.catalog_version !== catalog.catalog_version) errors.push(`${name} policy catalog_version must match catalog`);
  }
  return errors;
}
