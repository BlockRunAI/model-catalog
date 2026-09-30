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
    if (typeof model.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._+/-]*$/.test(model.id)) errors.push(`${at}.id must be a public model identifier`);
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

  const byId = new Map((catalog.models ?? []).map((model) => [model.id, model]));
  const virtualEntries = new Set();
  for (const view of Object.values(pickerPolicy.views ?? {})) {
    for (const id of view.virtual_entries ?? []) virtualEntries.add(id);
  }
  const isSolanaChat = (id) => {
    const network = byId.get(id)?.networks?.solana;
    return Boolean(network?.listed && network.categories.includes("chat"));
  };

  if (pickerPolicy.default_network !== "solana") errors.push("picker policy default_network must be solana");
  for (const [name, view] of Object.entries(pickerPolicy.views ?? {})) {
    const seen = new Set();
    for (const id of view.model_ids ?? []) {
      if (!ids.has(id)) errors.push(`picker view ${name} references missing model ${id}`);
      if (seen.has(id)) errors.push(`picker view ${name} repeats ${id}`);
      seen.add(id);
      if (ids.has(id) && !isSolanaChat(id)) errors.push(`picker view ${name} references model unavailable for Solana chat: ${id}`);
    }
    const grouped = new Set();
    for (const group of view.groups ?? []) {
      for (const id of group.model_ids ?? []) {
        if (!seen.has(id)) errors.push(`picker group ${group.id} references model outside view ${name}: ${id}`);
        if (grouped.has(id)) errors.push(`picker view ${name} groups repeat ${id}`);
        grouped.add(id);
      }
    }
    if ((view.groups ?? []).length > 0) {
      for (const id of seen) if (!grouped.has(id)) errors.push(`picker view ${name} does not group ${id}`);
    }
    for (const [shortcut, target] of Object.entries(view.shortcuts ?? {})) {
      if (!isSolanaChat(target) && !virtualEntries.has(target)) errors.push(`picker shortcut ${shortcut} has invalid target ${target}`);
    }
  }

  if (routerPolicy.default_network !== "solana") errors.push("router policy default_network must be solana");
  for (const [name, candidates] of Object.entries(routerPolicy.candidate_sets ?? {})) {
    const seen = new Set();
    for (const id of candidates) {
      if (!ids.has(id)) errors.push(`router candidate set ${name} references missing model ${id}`);
      if (seen.has(id)) errors.push(`router candidate set ${name} repeats ${id}`);
      if (ids.has(id) && !isSolanaChat(id)) errors.push(`router candidate set ${name} references model unavailable for Solana chat: ${id}`);
      seen.add(id);
    }
  }
  for (const [name, candidates] of Object.entries(routerPolicy.free_candidate_sets ?? {})) {
    const seen = new Set();
    for (const id of candidates) {
      const model = byId.get(id);
      if (!model) errors.push(`free router candidate set ${name} references missing model ${id}`);
      if (seen.has(id)) errors.push(`free router candidate set ${name} repeats ${id}`);
      if (model && !isSolanaChat(id)) errors.push(`free router candidate set ${name} references model unavailable for Solana chat: ${id}`);
      if (model?.networks?.solana?.billing_mode !== "free") errors.push(`free router candidate set ${name} references paid model ${id}`);
      seen.add(id);
    }
  }
  if (!isSolanaChat(routerPolicy.classifier_model)) {
    errors.push(`router classifier_model is unavailable for Solana chat: ${routerPolicy.classifier_model}`);
  }

  for (const [name, policy] of [["picker", pickerPolicy], ["router", routerPolicy]]) {
    if (policy.schema_version !== 1) errors.push(`${name} policy schema_version must be 1`);
    if (policy.catalog_version !== catalog.catalog_version) errors.push(`${name} policy catalog_version must match catalog`);
  }
  return errors;
}
