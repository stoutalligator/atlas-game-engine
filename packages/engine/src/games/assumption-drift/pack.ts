import { dayIndex } from "../../core/daily.js";

// Assumption Drift content lives in the host (ATLAS keeps one folder of packs
// per exam). The engine validates packs and picks today's.

export interface DriftChoice {
  id: string;
  label: string;
}

export interface DriftQuestion {
  id: string;
  scenario: string;
  drift: string;
  prompt: string;
  choiceStyle?: string;
  choices: DriftChoice[];
  answer: string;
  solution: { text: string };
}

export interface AssumptionDriftPack {
  schemaVersion: number;
  gameType: "assumption_drift";
  gameId: string;
  packId: string;
  title: string;
  meta?: { difficulty?: string; tags?: string[] };
  payload: {
    instructions: string;
    questions: DriftQuestion[];
  };
}

export class PackError extends Error {}

const str = (v: unknown, path: string): string => {
  if (typeof v !== "string" || v.trim() === "")
    throw new PackError(`${path} must be a non-empty string`);
  return v;
};

/** Validates unknown JSON as an Assumption Drift pack. Throws PackError with the bad path. */
export function parseAssumptionDriftPack(raw: unknown): AssumptionDriftPack {
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== "object") throw new PackError("pack must be an object");
  if (o.gameType !== "assumption_drift") throw new PackError('gameType must be "assumption_drift"');
  const payload = o.payload as Record<string, unknown> | undefined;
  if (!payload || !Array.isArray(payload.questions) || payload.questions.length === 0)
    throw new PackError("payload.questions must be a non-empty array");

  const questions = payload.questions.map((q: Record<string, unknown>, qi: number) => {
    const at = `payload.questions[${qi}]`;
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6)
      throw new PackError(`${at}.choices must have 2–6 items`);
    const choices = q.choices.map((c: Record<string, unknown>, ci: number) => ({
      id: str(c?.id, `${at}.choices[${ci}].id`),
      label: str(c?.label, `${at}.choices[${ci}].label`),
    }));
    const answer = str(q.answer, `${at}.answer`);
    if (!choices.some((c) => c.id === answer))
      throw new PackError(`${at}.answer "${answer}" is not one of the choice ids`);
    const solution = q.solution as Record<string, unknown> | undefined;
    return {
      id: str(q.id, `${at}.id`),
      scenario: str(q.scenario, `${at}.scenario`),
      drift: str(q.drift, `${at}.drift`),
      prompt: str(q.prompt, `${at}.prompt`),
      choiceStyle: typeof q.choiceStyle === "string" ? q.choiceStyle : undefined,
      choices,
      answer,
      solution: { text: str(solution?.text, `${at}.solution.text`) },
    };
  });

  return {
    schemaVersion: typeof o.schemaVersion === "number" ? o.schemaVersion : 1,
    gameType: "assumption_drift",
    gameId: str(o.gameId, "gameId"),
    packId: str(o.packId, "packId"),
    title: str(o.title, "title"),
    meta: (o.meta as AssumptionDriftPack["meta"]) ?? {},
    payload: {
      instructions:
        typeof payload.instructions === "string"
          ? payload.instructions
          : "A single assumption changes. Predict the impact.",
      questions,
    },
  };
}

/** Rotates through the packs one per day, in the order given. */
export function packForDate<T>(packs: readonly T[], date: string): T | null {
  if (packs.length === 0) return null;
  const n = packs.length;
  return packs[((dayIndex(date) % n) + n) % n];
}

/** "Assumption Drift — Duration Sensitivity" → "Duration Sensitivity". */
export function packSubtitle(pack: AssumptionDriftPack): string {
  return pack.title.replace(/^Assumption Drift\s*[—–-]\s*/i, "");
}
