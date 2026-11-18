// Refreshes the Doodle sandbox bank from an ATLAS checkout, with every
// source's variants already cut (so the page doesn't spend seconds on it):
//   pnpm --filter playground sync:doodle [path/to/atlas]   (default: a sibling ../atlas checkout)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickDoodleVariants } from "../../../packages/engine/src/games/doodle/logic.js";
import type { DoodleSource } from "../../../packages/engine/src/games/doodle/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const atlas = path.resolve(process.argv[2] ?? path.join(here, "../../../../atlas"));
const dir = path.join(atlas, "content", "doodle", "sources");
if (!fs.existsSync(dir)) {
  console.error(`No Doodle sources at ${dir}. Pass the path to your ATLAS checkout.`);
  process.exit(1);
}
const sources: DoodleSource[] = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .flatMap((f) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    return Array.isArray(raw) ? raw : [raw];
  });
const variants = sources.flatMap((s) => pickDoodleVariants(s));
const out = path.join(here, "../src/packs/doodle_bank.json");
fs.writeFileSync(out, JSON.stringify({ sources, variants }));
console.log(
  `Wrote ${sources.length} sources and ${variants.length} variants to ${path.relative(process.cwd(), out)}`,
);
