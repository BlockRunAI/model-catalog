import { readJson, validateAll } from "./lib.mjs";

const root = new URL("../", import.meta.url);
const [catalog, pickerPolicy, routerPolicy] = await Promise.all([
  readJson(new URL("source/catalog.json", root)),
  readJson(new URL("source/picker-policy.json", root)),
  readJson(new URL("source/router-policy.json", root)),
]);
const errors = validateAll(catalog, pickerPolicy, routerPolicy);
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`catalog ${catalog.catalog_version}: ${catalog.models.length} models; picker/router references valid`);
}
