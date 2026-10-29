// One normalization for answers and guesses: uppercase A–Z only. Accents fold
// to their base letter (CRÈME → CREME); spaces, hyphens, apostrophes and other
// punctuation drop out. Anything else (digits, other scripts) makes the input
// invalid rather than silently changing its letters.

const STRIP = /[\s\-\u2010-\u2015'\u2018\u2019`.\u00b7_/&,!?"\u201c\u201d]/g;
// biome-ignore lint/suspicious/noMisleadingCharacterClass: the class is the combining marks
const COMBINING = /[\u0300-\u036f]/g;
const LETTERS = /^[A-Z]*$/;

/** Folds a few letters NFD doesn't split. */
const SPECIAL: Record<string, string> = {
  ß: "SS",
  Æ: "AE",
  æ: "AE",
  Œ: "OE",
  œ: "OE",
  Ø: "O",
  ø: "O",
};

/**
 * Grid letters for an answer or a guess, or null if it contains something that
 * isn't a letter once punctuation and spacing are removed.
 */
export function normalizeWord(input: string): string | null {
  if (typeof input !== "string") return null;
  const folded = input
    .trim()
    .replace(/[ßÆæŒœØø]/g, (ch) => SPECIAL[ch])
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(STRIP, "")
    .toUpperCase();
  return LETTERS.test(folded) ? folded : null;
}

/** For callers that already know the input is valid (bank content, tests). */
export function normalizeOrThrow(input: string): string {
  const n = normalizeWord(input);
  if (!n) throw new Error(`"${input}" has characters that aren't letters`);
  return n;
}

/** One typed character → a grid letter, or null. */
export function normalizeLetter(ch: string): string | null {
  const n = normalizeWord(ch);
  return n && n.length === 1 ? n : null;
}
