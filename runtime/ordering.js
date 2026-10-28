export function isReleaseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function modelVersion(id) {
  const suffix = id.slice(id.indexOf('/') + 1).toLowerCase();
  // Read the generation, never a parameter count (32b), context size or date.
  // Older Claude and Grok IDs sometimes separate version components with '-'.
  const match = suffix.match(/^(?:claude-(?:(?:fable|opus|sonnet|haiku)-)?|gpt-|gemini-|grok-|glm-)(\d+(?:[.-]\d{1,2})*)(?=$|[^\d.])/) ??
    suffix.match(/^(?:o|kimi-k|minimax-m|deepseek-v|qwen|mimo-v|nemotron-|laguna-(?:xs|s)-|mistral-(?:large|small)-)(\d+(?:\.\d+)*)(?=$|[^\d.])/);
  return match ? match[1].split(/[.-]/).map(Number) : [];
}

/**
 * Sort one provider's models newest first without mutating the input.
 * Complete release dates take precedence. Until the provider has complete date
 * coverage, compare generation components numerically; same-generation models
 * keep their input order. `created` is deliberately ignored: gateways expose a
 * compatibility placeholder, not the model's release date.
 */
export function sortModelsNewestFirst(models) {
  const dated = models.length > 0 && models.every(model => isReleaseDate(model.release_date));
  const versions = new Map(models.map(model => [model.id, modelVersion(model.id)]));
  return [...models].sort((a, b) => {
    if (dated) return b.release_date.localeCompare(a.release_date);
    const av = versions.get(a.id), bv = versions.get(b.id);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const delta = (bv[i] ?? 0) - (av[i] ?? 0);
      if (delta) return delta;
    }
    return 0;
  });
}

