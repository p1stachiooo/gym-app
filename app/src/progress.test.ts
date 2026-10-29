/// <reference types="node" />
// Phase 9 — vector-replay test for progress.ts, run via `tsx` (no test
// framework needed). Loads the SHARED cross-language fixtures
// (`desktop/phase9_vectors.json`, authored by `desktop/test_progress.py`'s
// counterpart, `progress.py`) and asserts computeProgress reproduces every
// `expect` within 1e-6 — the same contract phase9-xp-spec.md §8 requires of
// both implementations. Also runs targeted behavioral checks for the
// §Cardio note (mirroring `desktop/test_progress.py`'s (c) section):
// cardio-only earns consistency but leaves progression/volume at exactly 0,
// and interleaving cardio into a strength log leaves the strength axes
// byte-identical while consistency reflects the added sessions.
//
// Run with: `npm run test:progress` (from app/) or `npx tsx src/progress.test.ts`.
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeProgress, type RegistryExercise, type RegistryGroup, type WorkoutSet } from "./progress";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "../../desktop/phase9_vectors.json");
const TOL = 1e-6;

interface Vector {
  name: string;
  workouts: WorkoutSet[];
  registry: { exercises: RegistryExercise[]; groups: RegistryGroup[] };
  vetoes: string[];
  asOf: string;
  params: Record<string, number> | null;
  expect: unknown;
}

let failures = 0;

/** Recursively compare JSON-shaped structures: numbers within TOL, everything
 * else exact. Mirrors `desktop/test_progress.py`'s `_assert_close`. Object key
 * sets must match exactly (dicts); array lengths must match exactly. */
function assertClose(actual: unknown, expected: unknown, path: string): void {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      failures++;
      console.error(`${path}: expected object, got ${JSON.stringify(actual)}`);
      return;
    }
    const expectedObj = expected as Record<string, unknown>;
    const actualObj = actual as Record<string, unknown>;
    const ek = Object.keys(expectedObj).sort();
    const ak = Object.keys(actualObj).sort();
    if (ek.join(",") !== ak.join(",")) {
      failures++;
      console.error(`${path}: key mismatch [${ak.join(", ")}] != [${ek.join(", ")}]`);
    }
    for (const k of ek) assertClose(actualObj[k], expectedObj[k], `${path}.${k}`);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      failures++;
      console.error(`${path}: expected array, got ${JSON.stringify(actual)}`);
      return;
    }
    if (actual.length !== expected.length) {
      failures++;
      console.error(`${path}: length ${actual.length} != ${expected.length}`);
      return;
    }
    expected.forEach((e, i) => assertClose(actual[i], e, `${path}[${i}]`));
    return;
  }

  if (typeof expected === "number") {
    if (typeof actual !== "number" || Number.isNaN(actual) || Math.abs(actual - expected) > TOL) {
      failures++;
      console.error(`${path}: ${actual} != ${expected} (tol ${TOL})`);
    }
    return;
  }

  if (actual !== expected) {
    failures++;
    console.error(`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

/** True-or-fail assertion in the same style as assertClose: bumps the shared
 * `failures` counter and logs instead of throwing, so one bad check doesn't
 * abort the rest of the run. */
function assertTrue(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(msg);
  }
}

/** Targeted behavioral assertions for the §Cardio note (phase9-xp-spec.md),
 * mirroring `desktop/test_progress.py`'s (c) section: cardio-only earns
 * consistency but leaves progression/volume at exactly 0 (never NaN), and
 * interleaving cardio into a strength log leaves the strength axes
 * byte-identical while consistency reflects the added sessions. */
function checkCardioProperties(byName: Map<string, Vector>): void {
  const cardioOnly = byName.get("cardio_only_stretch");
  const baseline = byName.get("decay_before_gap");
  const interleaved = byName.get("cardio_interleaved_with_strength");
  if (!cardioOnly || !baseline || !interleaved) {
    failures++;
    console.error("cardio vectors: expected cardio_only_stretch, decay_before_gap, and cardio_interleaved_with_strength in phase9_vectors.json");
    return;
  }

  const cardioOnlyActual = computeProgress(
    cardioOnly.workouts, cardioOnly.registry.exercises, cardioOnly.registry.groups, cardioOnly.vetoes, undefined, cardioOnly.asOf
  );
  assertTrue(cardioOnlyActual.components.consistency > 0, "cardio_only_stretch: consistency should be > 0 (a session is a session)");
  assertTrue(cardioOnlyActual.components.progression === 0, "cardio_only_stretch: progression should be exactly 0 (strength-only axis, no strength sets)");
  assertTrue(cardioOnlyActual.components.volume === 0, "cardio_only_stretch: volume should be exactly 0 (strength-only axis, no strength sets)");
  assertTrue(!Number.isNaN(cardioOnlyActual.components.progression) && !Number.isNaN(cardioOnlyActual.components.volume), "cardio_only_stretch: progression/volume must never be NaN");
  assertClose(cardioOnlyActual.perGroup, { Chest: { xp: 0, level: 0 }, Back: { xp: 0, level: 0 } }, "cardio_only_stretch.perGroup (untrained, §7)");

  const baselineActual = computeProgress(
    baseline.workouts, baseline.registry.exercises, baseline.registry.groups, baseline.vetoes, undefined, baseline.asOf
  );
  const interleavedActual = computeProgress(
    interleaved.workouts, interleaved.registry.exercises, interleaved.registry.groups, interleaved.vetoes, undefined, interleaved.asOf
  );
  assertClose(interleavedActual.components.progression, baselineActual.components.progression, "cardio_interleaved_with_strength.components.progression (must match the cardio-free baseline exactly)");
  assertClose(interleavedActual.components.volume, baselineActual.components.volume, "cardio_interleaved_with_strength.components.volume (must match the cardio-free baseline exactly)");
  assertClose(interleavedActual.baselines, baselineActual.baselines, "cardio_interleaved_with_strength.baselines (must match the cardio-free baseline exactly)");
  assertTrue(
    interleavedActual.components.consistency > baselineActual.components.consistency,
    "cardio_interleaved_with_strength: consistency should exceed the cardio-free baseline (extra distinct cardio sessions)"
  );
}

function main(): void {
  const vectors: Vector[] = JSON.parse(readFileSync(VECTORS_PATH, "utf-8"));
  const vectorsByName = new Map(vectors.map((v) => [v.name, v]));

  for (const v of vectors) {
    const params = v.params && Object.keys(v.params).length > 0 ? v.params : undefined;
    const before = failures;
    const actual = computeProgress(v.workouts, v.registry.exercises, v.registry.groups, v.vetoes, params, v.asOf);
    assertClose(actual, v.expect, v.name);
    if (failures === before) {
      console.log(`ok  - ${v.name}`);
    } else {
      console.log(`FAIL - ${v.name}`);
    }
  }

  const beforeCardio = failures;
  checkCardioProperties(vectorsByName);
  console.log(beforeCardio === failures ? "ok  - cardio: consistency-only, strength-axes-untouched" : "FAIL - cardio: consistency-only, strength-axes-untouched");

  if (failures > 0) {
    console.error(`\n${failures} mismatch(es) across ${vectors.length} vectors.`);
    process.exit(1);
  } else {
    console.log(`\nOK: all ${vectors.length} vectors matched within ${TOL}.`);
  }
}

main();
