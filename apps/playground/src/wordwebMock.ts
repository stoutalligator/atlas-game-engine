import { createBankGenerator, generateForDate, parseBank } from "@stoutalligator/engine/server";
import { WORDWEB_TEST_BANK } from "../../../packages/engine/src/__tests__/fixtures/wordwebBank";

// Stand-in for the host: runs the real WordWeb pipeline in the browser
// against the test bank, so any date can be previewed. ATLAS runs the same
// pipeline in a script and serves only validated puzzles.

const generator = createBankGenerator(parseBank(WORDWEB_TEST_BANK));

export async function generatedWordWeb(date: string): Promise<unknown[]> {
  const { record } = await generateForDate({ date, generator, history: [] });
  return record ? [record.puzzle] : [];
}
