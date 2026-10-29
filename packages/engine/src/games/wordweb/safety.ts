import { normalizeWord } from "./normalize.js";
import type { AnswerKind, ValidatorResult } from "./types.js";

// Deterministic content policy, applied to every candidate whatever produced
// it. A generator's own safety notes are recorded but never trusted on their
// own. Hosts can extend the lists through SafetyOptions.

/** Topics kept out of a workplace learning game. Matched as whole words. */
export const DENY_TERMS: Record<string, readonly string[]> = {
  adult: ["SEX", "SEXY", "NUDE", "NAKED", "PORN", "EROTIC", "LINGERIE", "STRIPPER", "BROTHEL"],
  violence: [
    "KILL",
    "MURDER",
    "BLOOD",
    "GORE",
    "GUN",
    "GUNS",
    "RIFLE",
    "PISTOL",
    "BOMB",
    "WEAPON",
    "WEAPONS",
    "TORTURE",
    "STAB",
    "CORPSE",
  ],
  drugs: [
    "COCAINE",
    "HEROIN",
    "METH",
    "WEED",
    "MARIJUANA",
    "CANNABIS",
    "LSD",
    "OPIUM",
    "STONED",
    "BONG",
  ],
  gambling: ["CASINO", "POKER", "BLACKJACK", "ROULETTE", "BETTING", "SLOTS", "BOOKIE", "LOTTERY"],
  politics: [
    "DEMOCRAT",
    "REPUBLICAN",
    "LIBERAL",
    "CONSERVATIVE",
    "ELECTION",
    "PARTISAN",
    "ABORTION",
    "IMMIGRATION",
  ],
  religion: [
    "BIBLE",
    "KORAN",
    "QURAN",
    "TORAH",
    "SAINT",
    "SAINTS",
    "PROPHET",
    "GODS",
    "DEITY",
    "DEITIES",
  ],
  health: [
    "CANCER",
    "TUMOR",
    "DIABETES",
    "AUTISM",
    "DEPRESSION",
    "SUICIDE",
    "DISEASE",
    "DISEASES",
    "HIV",
    "AIDS",
    "DEMENTIA",
    "OVERDOSE",
  ],
  disaster: [
    "DISASTER",
    "TRAGEDY",
    "TERROR",
    "TERRORISM",
    "MASSACRE",
    "GENOCIDE",
    "CRASH",
    "TSUNAMI",
    "PANDEMIC",
    "WAR",
    "WARS",
  ],
  profanity: [
    "DAMN",
    "HELL",
    "CRAP",
    "PISS",
    "BASTARD",
    "BITCH",
    "SHIT",
    "FUCK",
    "ASS",
    "ASSES",
    "DICK",
    "COCK",
    "SLUT",
    "WHORE",
  ],
  insulting: [
    "STUPID",
    "IDIOT",
    "MORON",
    "UGLY",
    "FAT",
    "LOSER",
    "DUMB",
    "CRAZY",
    "INSANE",
    "LAME",
  ],
  identity: ["ETHNICITY", "GENDER", "GENDERS", "DISABILITY", "DISABLED", "NATIONALITY"],
};

/** Trademarks people use as everyday words. Prohibited as answers. */
export const BRAND_TERMS = [
  "FRISBEE",
  "VELCRO",
  "KLEENEX",
  "XEROX",
  "JACUZZI",
  "POPSICLE",
  "BANDAID",
  "QTIP",
  "POSTIT",
  "ZIPLOC",
  "JELLO",
  "LEGO",
  "LEGOS",
  "TUPPERWARE",
  "STYROFOAM",
  "SHARPIE",
  "ROLODEX",
  "TASER",
  "CROCKPOT",
  "DUMPSTER",
  "TEFLON",
  "BUBBLEWRAP",
  "SPEEDO",
  "WALKMAN",
  "IPOD",
  "IPHONE",
  "GOOGLE",
  "PLEXIGLAS",
  "INSTAPOT",
  "WEEDWACKER",
  "ROLLERBLADE",
  "ROLLERBLADES",
];

/** Actuarial abbreviations allowed in actuarial categories only. */
export const ACTUARIAL_ABBREVIATIONS = [
  "FSA",
  "ASA",
  "SOA",
  "CAS",
  "FCAS",
  "ACAS",
  "PMPM",
  "IBNR",
  "LDF",
  "ELR",
  "MLR",
  "ALAE",
  "ULAE",
  "PBM",
  "HMO",
  "PPO",
  "EPO",
  "CDF",
  "VAR",
  "TVAR",
  "LDTI",
  "GAAP",
  "STAT",
  "ERM",
  "ORSA",
  "RBC",
];

export interface SafetyItem {
  display: string;
  kind?: AnswerKind;
  /** Content source flags (bank metadata or a provider's own labels). */
  proper?: boolean;
  brand?: boolean;
}

export interface SafetyOptions {
  extraDenyTerms?: readonly string[];
  extraBrands?: readonly string[];
}

const tokens = (text: string) =>
  text
    .normalize("NFD")
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: strips combining accents
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);

function deniedIn(text: string, extra: readonly string[]): string[] {
  const hits: string[] = [];
  const words = new Set(tokens(text));
  for (const [topic, list] of Object.entries(DENY_TERMS))
    for (const t of list) if (words.has(t)) hits.push(`${topic}:${t}`);
  for (const t of extra) if (words.has(t.toUpperCase())) hits.push(`host:${t}`);
  return hits;
}

/** Category-level checks: the category name and its rationale text. */
export function checkCategorySafety(
  category: string,
  options: SafetyOptions = {},
): ValidatorResult {
  const hits = deniedIn(category, options.extraDenyTerms ?? []);
  return hits.length
    ? { rule: "safe-category", ok: false, detail: `"${category}" touches ${hits.join(", ")}` }
    : { rule: "safe-category", ok: true };
}

/** Why an answer (or alternate) can't be used, or null if it can. */
export function answerPolicyProblem(
  item: SafetyItem,
  actuarial: boolean,
  options: SafetyOptions = {},
): string | null {
  const grid = normalizeWord(item.display);
  if (!grid) return `"${item.display}" isn't letters`;
  const denied = deniedIn(item.display, options.extraDenyTerms ?? []);
  if (denied.length) return `"${item.display}" touches ${denied.join(", ")}`;
  const brands = new Set([
    ...BRAND_TERMS,
    ...(options.extraBrands ?? []).map((b) => b.toUpperCase()),
  ]);
  if (item.brand || brands.has(grid)) return `"${item.display}" is a brand name`;
  if (item.proper) return `"${item.display}" is a proper noun`;
  if (item.kind === "abbreviation") {
    if (!actuarial) return `"${item.display}" is an abbreviation in a general category`;
    if (!ACTUARIAL_ABBREVIATIONS.includes(grid))
      return `"${item.display}" isn't an approved actuarial abbreviation`;
  }
  return null;
}

/**
 * Answers that are effectively the same word: equal, singular/plural pairs,
 * or one inside the other (FISH / GOLDFISH).
 */
export function nearDuplicates(grids: string[]): string[] {
  const out: string[] = [];
  const plural = (a: string, b: string) =>
    b === `${a}S` || b === `${a}ES` || (a.endsWith("Y") && b === `${a.slice(0, -1)}IES`);
  for (let i = 0; i < grids.length; i++)
    for (let j = i + 1; j < grids.length; j++) {
      const [a, b] = [grids[i], grids[j]];
      if (a === b) out.push(`${a} twice`);
      else if (plural(a, b) || plural(b, a)) out.push(`${a}/${b} are singular and plural`);
      else if (a.includes(b) || b.includes(a)) out.push(`${a}/${b} overlap`);
    }
  return out;
}
