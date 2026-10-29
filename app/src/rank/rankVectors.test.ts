/// <reference types="node" />
// Rank engine — vector-replay test for rankEngine.ts, run via `tsx` (no test
// framework needed), mirroring `../progress.test.ts`'s pattern exactly.
// Loads the SHARED cross-language fixtures (`desktop/rank_vectors.json`,
// authored by `desktop/test_rank_engine.py`'s counterpart, `rank_engine.py`)
// and asserts evaluateRank reproduces every `expect` exactly (all integers —
// no tolerance needed, unlike the XP engine's phase9_vectors.json). This
// guards the TS side from drifting off the shared file, the same way
// `desktop/test_rank_engine.py` guards the Python side.
//
// Run with: `npm run test:rankvec` (from app/) or `npx tsx src/rank/rankVectors.test.ts`.
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { type WorkoutSet } from "../progress";
import { epochDayOf, evaluateRank } from "./rankEngine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "../../../desktop/rank_vectors.json");

interface ExpectShape {
  xp: number;
  slipOffset: number;
  rankId: number;
  peakRankId: number;
  slipsApplied: number;
}

interface Vector {
  name: string;
  sets: WorkoutSet[];
  vetoes: string[];
  asof: string;
  expect: ExpectShape;
}

let failures = 0;

function assertEqual(actual: number, expected: number, msg: string): void {
  if (actual !== expected) {
    failures++;
    console.error(`${msg}: got ${actual}, want ${expected}`);
  }
}

function main(): void {
  const vectors: Vector[] = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));

  for (const v of vectors) {
    const before = failures;
    const result = evaluateRank(v.sets, v.vetoes, epochDayOf(v.asof));
    const actual: ExpectShape = {
      xp: result.state.xp,
      slipOffset: result.state.slipOffset,
      rankId: result.rank.rankId,
      peakRankId: result.peakRankId,
      slipsApplied: result.slipsApplied,
    };
    assertEqual(actual.xp, v.expect.xp, `${v.name}.xp`);
    assertEqual(actual.slipOffset, v.expect.slipOffset, `${v.name}.slipOffset`);
    assertEqual(actual.rankId, v.expect.rankId, `${v.name}.rankId`);
    assertEqual(actual.peakRankId, v.expect.peakRankId, `${v.name}.peakRankId`);
    assertEqual(actual.slipsApplied, v.expect.slipsApplied, `${v.name}.slipsApplied`);
    console.log(failures === before ? `ok  - ${v.name}` : `FAIL - ${v.name}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} mismatch(es) across ${vectors.length} vectors.`);
    process.exit(1);
  } else {
    console.log(`\nOK: all ${vectors.length} rank vectors matched exactly.`);
  }
}

main();
