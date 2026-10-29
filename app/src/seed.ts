// Phase 7 — the authored first-pass registry seed (from hercules-phases-7-10.md,
// authored 2026-07-02; taxonomy refined in Phase 14). 17 coarse muscle groups +
// the starting exercises with primary/secondary weighted muscle credits.
// Weights: primary 1.0, meaningful secondary 0.5, minor stabilizer 0.25.
// `emphasis` preserves finer-than-group detail (e.g. "rear delt", "soleus")
// without splitting the coarse taxonomy.
//
// This file is DATA ONLY — written once per account by seedRegistryIfEmpty().
// After seeding, Firestore is the source of truth; edits there win.
import type { MovementPattern, MuscleCredit } from "./registry";

export const SEED_GROUPS = [
  "Chest",
  "Lats",
  "Upper Back",
  "Lower Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Adductors",
  "Abductors",
  "Calves",
  "Core",
  "Forearms",
  "Traps",
  "Cardio",
] as const;

interface SeedExercise {
  name: string;
  muscles: MuscleCredit[];
  kind?: "cardio"; // logged by duration, not weight×reps
  pattern?: MovementPattern; // analytics axis (push/pull balance); no XP effect
}

const P = (group: string, emphasis?: string): MuscleCredit =>
  emphasis
    ? { group, role: "primary", weight: 1.0, emphasis }
    : { group, role: "primary", weight: 1.0 };
const S = (group: string, weight: number, emphasis?: string): MuscleCredit =>
  emphasis
    ? { group, role: "secondary", weight, emphasis }
    : { group, role: "secondary", weight };

export const SEED_EXERCISES: SeedExercise[] = [
  // Chest
  {
    name: "Flat Barbell Bench Press",
    pattern: "Push",
    muscles: [P("Chest"), S("Triceps", 0.5), S("Shoulders", 0.5, "front delt")],
  },
  {
    name: "Incline Dumbbell Press",
    pattern: "Push",
    muscles: [P("Chest"), S("Triceps", 0.5), S("Shoulders", 0.5, "front delt")],
  },
  {
    name: "Chest Fly",
    pattern: "Isolation",
    muscles: [P("Chest"), S("Shoulders", 0.25, "front delt")],
  },
  {
    name: "High-to-Low Cable Fly",
    pattern: "Isolation",
    muscles: [P("Chest"), S("Shoulders", 0.25, "front delt")],
  },
  {
    name: "Low-to-High Cable Fly",
    pattern: "Isolation",
    muscles: [P("Chest"), S("Shoulders", 0.25, "front delt")],
  },

  // Back (split into Lats / Upper Back / Lower Back in Phase 14)
  {
    name: "Close-Grip Seated Cable Row",
    pattern: "Pull",
    muscles: [
      P("Upper Back"),
      S("Lats", 0.5),
      S("Biceps", 0.5),
      S("Shoulders", 0.25, "rear delt"),
    ],
  },
  {
    name: "Lat Pulldown",
    pattern: "Pull",
    muscles: [P("Lats"), S("Upper Back", 0.25), S("Biceps", 0.5)],
  },
  {
    name: "Seated Row (Machine)",
    pattern: "Pull",
    muscles: [
      P("Upper Back"),
      S("Lats", 0.5),
      S("Biceps", 0.5),
      S("Shoulders", 0.5, "rear delt"),
    ],
  },
  {
    name: "Face Pull",
    pattern: "Pull",
    muscles: [P("Shoulders", "rear delt"), S("Traps", 0.5), S("Upper Back", 0.25)],
  },
  {
    name: "Back Extension",
    pattern: "Hinge",
    muscles: [P("Lower Back"), S("Glutes", 0.5), S("Hamstrings", 0.5)],
  },

  // Shoulders
  {
    name: "Shoulder Press",
    pattern: "Push",
    muscles: [P("Shoulders"), S("Triceps", 0.5)],
  },
  {
    name: "Rear Delt Fly",
    pattern: "Isolation",
    muscles: [P("Shoulders", "rear delt"), S("Traps", 0.25)],
  },
  {
    name: "Lateral Raise",
    pattern: "Isolation",
    muscles: [P("Shoulders", "side delt")],
  },

  // Biceps
  {
    name: "Seated Curl",
    pattern: "Isolation",
    muscles: [P("Biceps"), S("Forearms", 0.25)],
  },
  {
    name: "Hammer Curl",
    pattern: "Isolation",
    muscles: [P("Biceps"), S("Forearms", 0.5)],
  },
  {
    name: "Cross-Body Hammer Curl",
    pattern: "Isolation",
    muscles: [P("Biceps"), S("Forearms", 0.5)],
  },
  { name: "Preacher Curl", pattern: "Isolation", muscles: [P("Biceps")] },

  // Triceps
  {
    name: "Overhead Tricep Extension (Low Pulley)",
    pattern: "Isolation",
    muscles: [P("Triceps")],
  },
  { name: "Cable Tricep Pushdown", pattern: "Isolation", muscles: [P("Triceps")] },
  {
    name: "Tricep Press Machine (Dips)",
    pattern: "Push",
    muscles: [P("Triceps"), S("Chest", 0.25)],
  },

  // Quads
  { name: "Leg Extension", pattern: "Isolation", muscles: [P("Quads")] },
  {
    name: "Barbell Back Squat",
    pattern: "Squat",
    muscles: [P("Quads"), S("Glutes", 0.5), S("Hamstrings", 0.5), S("Core", 0.25)],
  },
  {
    name: "Leg Press",
    pattern: "Squat",
    muscles: [P("Quads"), S("Glutes", 0.5), S("Hamstrings", 0.25)],
  },

  // Hamstrings
  { name: "Seated Leg Curl", pattern: "Isolation", muscles: [P("Hamstrings")] },
  { name: "Lying Leg Curl", pattern: "Isolation", muscles: [P("Hamstrings")] },

  // Hips (Adductors/Abductors split out of Glutes in Phase 14)
  {
    name: "Hip Abductor Machine",
    pattern: "Isolation",
    muscles: [P("Abductors")],
  },
  {
    name: "Hip Adductor Machine",
    pattern: "Isolation",
    muscles: [P("Adductors")],
  },

  // Calves (seated/standing kept separate: soleus vs. both heads)
  {
    name: "Seated Calf Raise",
    pattern: "Isolation",
    muscles: [P("Calves", "soleus")],
  },
  {
    name: "Standing Calf Raise (Smith)",
    pattern: "Isolation",
    muscles: [P("Calves")],
  },

  // Core
  {
    name: "Kettlebell Farmer's Walk",
    pattern: "Carry",
    muscles: [P("Core"), S("Forearms", 0.5), S("Traps", 0.5)],
  },
  { name: "Pallof Press-Out", pattern: "Core", muscles: [P("Core", "obliques")] },
  { name: "Cable Crunch", pattern: "Core", muscles: [P("Core")] },
  { name: "Decline Bench Crunch", pattern: "Core", muscles: [P("Core")] },
  {
    name: "Captain's Chair Leg Raise",
    pattern: "Core",
    muscles: [P("Core", "lower abs")],
  },

  // Forearms
  {
    name: "Reverse Cable Curl",
    pattern: "Isolation",
    muscles: [P("Forearms", "brachioradialis"), S("Biceps", 0.25)],
  },
  {
    name: "Seated Cable Wrist Extension",
    pattern: "Isolation",
    muscles: [P("Forearms", "extensors")],
  },
  {
    name: "Behind-the-Back Cable Wrist Curl",
    pattern: "Isolation",
    muscles: [P("Forearms", "flexors")],
  },

  // Traps
  { name: "Shrugs", pattern: "Isolation", muscles: [P("Traps")] },

  // Cardio — logged by DURATION (minutes), not weight×reps; `kind: "cardio"`
  // makes the app show a minutes input, and the Cardio group maps to the legs
  // on the body map. Cardio counts toward Consistency only (not Progression/Volume).
  { name: "Treadmill", kind: "cardio", pattern: "Cardio", muscles: [P("Cardio")] },
  { name: "Elliptical", kind: "cardio", pattern: "Cardio", muscles: [P("Cardio")] },
  {
    name: "Stationary Bike",
    kind: "cardio",
    pattern: "Cardio",
    muscles: [P("Cardio")],
  },
];
