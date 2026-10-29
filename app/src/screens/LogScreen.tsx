// Phase 2 logging UI + Phase 7 registry. Brutally simple, big tap targets,
// minimal typing: tap "Start workout", pick a muscle group, pick an exercise,
// nudge weight/reps with steppers, tap to log each set. Groups and exercises
// come from the Firestore registry (registry.ts) — user-extensible and synced
// across devices. Every set is exactly one writeSet() call and stamps only the
// exercise NAME; muscles are resolved via the registry at read time.
//
// Phase 10 — restyled against theme.ts to match the approved mockup: level/
// streak strip up top (ProgressCard), a focal accent-edged "Log" card for the
// set you're about to log, and a tighter blue-slate palette throughout. This
// pass changes styles and presentational JSX only — every hook, handler,
// piece of state, and prop below is untouched from the pre-restyle version.
//
// Stage 2 (cardio wiring): when the selected exercise's `kind === "cardio"`
// (registry.ts), the focal card swaps its weight/reps steppers for a
// duration (minutes) stepper + optional distance field and writes a cardio
// set via writeSet. The strength set-index/lastWeight memory stays
// strength-only; cardio has no equivalent bookkeeping.
import { useEffect, useMemo, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { confirmDestructive, notify } from "../alerts";
import { writeSet } from "../data";
import { describeGap, mostNeglectedGroup } from "../muscleMap";
import { getAckLevel, getAckRankId, setAckLevel, setAckRankId } from "../prefs";
import {
  computeProgress,
  type CardioWorkoutSet,
  type RegistryExercise,
  type RegistryGroup,
  type StrengthWorkoutSet,
  type WorkoutSet,
} from "../progress";
import {
  addExercise,
  addMuscleGroup,
  primaryGroup,
  setLastWeight,
  watchExercises,
  watchMuscleGroups,
  type Exercise,
  type MuscleCredit,
  type MuscleGroup,
} from "../registry";
import { evaluateRank, epochDayOf } from "../rank/rankEngine";
import RankLadderModal from "../rank/RankLadderModal";
import { medallionForRank } from "../rank/RankMedallion";
import { labelForRankId } from "../rank/rankArt";
import { localDate, startSession, type Session } from "../session";
import { watchVetoes } from "../vetoes";
import { watchWorkouts } from "../workouts";
import ProgressCard from "../components/ProgressCard";
import RestDayModal from "../components/RestDayModal";
import { colors, lift, radius, space, tabularNums, type } from "../theme";

const WEIGHT_STEP = 2.5;
const REPS_STEP = 1;
const SECONDARY_WEIGHT = 0.5;
const NEGLECT_THRESHOLD_DAYS = 14;
const DURATION_STEP = 5;
const DEFAULT_DURATION = 20;

type SaveStatus = "saving" | "saved" | "error";

// One row in the "this session" list. Carries its full payload so an errored
// write can be retried with the SAME identity (no gaps, no duplicates).
// `kind` discriminates which of the two payload shapes below is populated —
// strength (weight/reps/set) or cardio (duration/distance) — mirroring
// schema.ts's NewSet union.
interface LoggedSet {
  key: string;
  exercise: string;
  kind: "strength" | "cardio";
  status: SaveStatus;
  error?: string;
  weight?: number;
  reps?: number;
  set?: number;
  duration?: number;
  distance?: number;
}

const TOP_PAD =
  Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) + 8 : 52;

export default function LogScreen({
  email,
  onSignOut,
}: {
  email: string | null;
  onSignOut: () => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<MuscleGroup[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSet[]>([]);
  const [vetoes, setVetoes] = useState<string[]>([]);
  const [restDayVisible, setRestDayVisible] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("5");
  const [duration, setDuration] = useState(String(DEFAULT_DURATION));
  const [distance, setDistance] = useState("");
  const [custom, setCustom] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  // Add-exercise tagging: the name awaiting muscle tags, and the toggled
  // secondary groups. Primary is the currently-selected group.
  const [pending, setPending] = useState<string | null>(null);
  const [pendingSecondaries, setPendingSecondaries] = useState<string[]>([]);
  const [logged, setLogged] = useState<LoggedSet[]>([]);

  // Phase 13 — the highest overall level acknowledged so far (persisted;
  // null until loaded), and the level currently shown in the level-up
  // overlay (null = hidden). Also the one Reduce Motion check shared by
  // every animation on this screen — cheap, read once on mount.
  const [ackLevel, setAckLevelState] = useState<number | null>(null);
  const [levelUpLevel, setLevelUpLevel] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Gate the level-up detector until BOTH the persisted ack and the first
  // workouts snapshot have loaded (so first run baselines against the real
  // level, not the momentary empty-log level 0).
  const [ackLoaded, setAckLoaded] = useState(false);
  const [workoutsLoaded, setWorkoutsLoaded] = useState(false);
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const overlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logButtonScale = useRef(new Animated.Value(1)).current;

  // Rank moments — the highest rankId already acknowledged (persisted; null
  // until loaded), and the up/slip currently shown in the rank overlay (null
  // = hidden). Mirrors ackLevel/levelUpLevel above exactly, including the
  // ackRankIdLoaded+workoutsLoaded gate below that prevents a phantom
  // first-run moment.
  const [ackRankId, setAckRankIdState] = useState<number | null>(null);
  const [ackRankIdLoaded, setAckRankIdLoaded] = useState(false);
  const [rankMoment, setRankMoment] = useState<
    { kind: "up" | "slip"; rankId: number } | null
  >(null);
  const rankMomentAnim = useRef(new Animated.Value(0)).current;
  const rankMomentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phase 13 — neglect nudge: the coldest of the tracked groups, and
  // which group's banner (if any) the user has already dismissed.
  const [dismissedNeglect, setDismissedNeglect] = useState<string | null>(null);

  // Per-exercise state kept in refs so async writes read fresh values without
  // re-subscribing: how many sets logged this session, and last weight used
  // (in-session cache; the durable copy lives on the exercise doc).
  const setCounts = useRef<Record<string, number>>({});
  const lastWeight = useRef<Record<string, number>>({});
  const keySeq = useRef(0);

  useEffect(() => {
    const unsubGroups = watchMuscleGroups(setGroups);
    const unsubExercises = watchExercises(setExercises);
    const unsubWorkouts = watchWorkouts((w) => {
      setWorkouts(w);
      setWorkoutsLoaded(true);
    });
    const unsubVetoes = watchVetoes(setVetoes);
    return () => {
      unsubGroups();
      unsubExercises();
      unsubWorkouts();
      unsubVetoes();
    };
  }, []);

  // Load the acknowledged level once, and check Reduce Motion once.
  useEffect(() => {
    let mounted = true;
    getAckLevel()
      .then((n) => {
        if (mounted) {
          setAckLevelState(n);
          setAckLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setAckLevelState(null);
          setAckLoaded(true);
        }
      });
    getAckRankId()
      .then((n) => {
        if (mounted) {
          setAckRankIdState(n);
          setAckRankIdLoaded(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setAckRankIdState(null);
          setAckRankIdLoaded(true);
        }
      });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setReduceMotion(v);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Clear any pending auto-dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (overlayTimer.current) clearTimeout(overlayTimer.current);
      if (rankMomentTimer.current) clearTimeout(rankMomentTimer.current);
    };
  }, []);

  // Phase 9 — recompute XP/level fresh whenever the log or registry changes.
  // computeProgress is pure and mirrors its own Registry* input shapes rather
  // than importing registry.ts's, so exercises/groups are mapped to those
  // shapes here rather than passed straight through.
  const registryExercises: RegistryExercise[] = useMemo(
    () =>
      exercises.map((e) => ({
        name: e.name,
        muscles: e.muscles,
        lastWeight: e.lastWeight ?? null,
      })),
    [exercises]
  );
  const registryGroups: RegistryGroup[] = useMemo(
    () => groups.map((g) => ({ name: g.name, order: g.order })),
    [groups]
  );
  const progress = useMemo(
    () =>
      computeProgress(
        workouts,
        registryExercises,
        registryGroups,
        vetoes,
        undefined,
        localDate()
      ),
    [workouts, registryExercises, registryGroups, vetoes]
  );

  // Rank ladder — same lazy-evaluation call the engine expects: fold the
  // whole log + the user's marked rest days (vetoes.ts, watched above) as of
  // today into a RankResult, recomputed whenever the log or the rest-day
  // list changes.
  const rankResult = useMemo(
    () => evaluateRank(workouts, vetoes, epochDayOf(localDate())),
    [workouts, vetoes]
  );
  const [ladderVisible, setLadderVisible] = useState(false);

  // Rest-day chip badge count — vetoes marked in the current calendar month,
  // matching RestDayModal's own "N of 6 used this month" math.
  const monthlyVetoCount = useMemo(() => {
    const thisMonth = localDate().slice(0, 7);
    return vetoes.filter((d) => d.slice(0, 7) === thisMonth).length;
  }, [vetoes]);

  // Phase 13 — level-up celebration. Fires only when the live level rises
  // ABOVE the highest previously-acknowledged one; a later dip from decay and
  // recovery back to (or below) that same acknowledged high never re-fires
  // it — only a new high does. Guarded on ackLevel !== null so this can't
  // fire before the persisted ack has loaded.
  useEffect(() => {
    if (!ackLoaded || !workoutsLoaded) return;
    if (ackLevel === null) {
      // First run (ack never set): baseline silently to the current REAL level
      // so an existing player doesn't get a phantom level-up. No celebration.
      setAckLevelState(progress.level);
      void setAckLevel(progress.level).catch(() => {});
      return;
    }
    if (progress.level > ackLevel) {
      const next = progress.level;
      setAckLevelState(next);
      void setAckLevel(next).catch(() => {});
      showLevelUp(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.level, ackLevel, ackLoaded, workoutsLoaded]);

  function showLevelUp(level: number) {
    if (overlayTimer.current) clearTimeout(overlayTimer.current);
    setLevelUpLevel(level);
    if (reduceMotion) {
      overlayAnim.setValue(1);
    } else {
      overlayAnim.setValue(0);
      Animated.spring(overlayAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }).start();
    }
    overlayTimer.current = setTimeout(() => dismissLevelUp(), 2000);
  }

  function dismissLevelUp() {
    if (overlayTimer.current) {
      clearTimeout(overlayTimer.current);
      overlayTimer.current = null;
    }
    if (reduceMotion) {
      setLevelUpLevel(null);
      return;
    }
    Animated.timing(overlayAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setLevelUpLevel(null));
  }

  // Rank moments — fires when the live rank (already computed above as
  // rankResult.rank.rankId) moves off the highest previously-acknowledged
  // rank: upward is a celebration (rank up), downward is a slip (decay
  // dropped a division/tier). Declared AFTER the level-up effect above so
  // that when both a level-up and a rank moment would fire off the same log
  // (same workouts-derived recompute), this effect runs second in the same
  // commit and can pre-empt any level-up overlay that effect just triggered
  // — rank is the bigger deal, and only one overlay is ever shown at once.
  useEffect(() => {
    if (!ackRankIdLoaded || !workoutsLoaded) return;
    const liveRankId = rankResult.rank.rankId;
    if (ackRankId === null || workouts.length === 0) {
      // First run (ack never set), OR an empty log — which can only mean a
      // fresh/reset account, never a real "slip". Baseline silently to the
      // current rank so neither an existing player on first launch nor a
      // device whose stored ack survived an out-of-band data wipe gets a
      // phantom rank moment (a legitimate slip always has training history).
      setAckRankIdState(liveRankId);
      void setAckRankId(liveRankId).catch(() => {});
      return;
    }
    if (liveRankId > ackRankId) {
      setAckRankIdState(liveRankId);
      void setAckRankId(liveRankId).catch(() => {});
      showRankMoment("up", liveRankId);
    } else if (liveRankId < ackRankId) {
      setAckRankIdState(liveRankId);
      void setAckRankId(liveRankId).catch(() => {});
      showRankMoment("slip", liveRankId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankResult.rank.rankId, ackRankId, ackRankIdLoaded, workoutsLoaded]);

  function showRankMoment(kind: "up" | "slip", rankId: number) {
    // Pre-empt any level-up overlay currently showing (or just triggered
    // earlier in this same commit) — only one overlay at a time, rank wins.
    if (overlayTimer.current) {
      clearTimeout(overlayTimer.current);
      overlayTimer.current = null;
    }
    setLevelUpLevel(null);

    if (rankMomentTimer.current) clearTimeout(rankMomentTimer.current);
    setRankMoment({ kind, rankId });
    if (reduceMotion) {
      rankMomentAnim.setValue(1);
    } else {
      rankMomentAnim.setValue(0);
      Animated.spring(rankMomentAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }).start();
    }
    rankMomentTimer.current = setTimeout(() => dismissRankMoment(), 2000);
  }

  function dismissRankMoment() {
    if (rankMomentTimer.current) {
      clearTimeout(rankMomentTimer.current);
      rankMomentTimer.current = null;
    }
    if (reduceMotion) {
      setRankMoment(null);
      return;
    }
    Animated.timing(rankMomentAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setRankMoment(null));
  }

  // "Last weight × reps" / "Last: N min" per exercise, for the log card
  // prefill/display. Recency is ordered by (date, session, set) descending
  // rather than a `ts` field: session ids are already timestamp-based
  // strings ("YYYY-MM-DDTHH:MM"), so this triple is fully chronological
  // without needing Firestore's server-timestamp (which is also null on the
  // client until it round-trips, making it a worse recency key for
  // optimistic reads than the fields already on every set).
  //
  // Split by kind: a cardio set has no weight/reps and a strength set has no
  // duration, so "last set" for the weight×reps prefill must only ever
  // consider strength sets (and vice versa for the duration prefill) — an
  // exercise's most recent set overall could be the wrong kind if the same
  // name were ever logged both ways.
  const lastStrengthSetByExercise = useMemo(() => {
    const map = new Map<string, StrengthWorkoutSet>();
    for (const w of workouts) {
      if (!isStrengthWorkoutSet(w)) continue;
      const cur = map.get(w.exercise);
      if (!cur || isMoreRecent(w, cur)) map.set(w.exercise, w);
    }
    return map;
  }, [workouts]);
  const lastCardioSetByExercise = useMemo(() => {
    const map = new Map<string, CardioWorkoutSet>();
    for (const w of workouts) {
      if (!isCardioWorkoutSet(w)) continue;
      const cur = map.get(w.exercise);
      if (!cur || isMoreRecent(w, cur)) map.set(w.exercise, w);
    }
    return map;
  }, [workouts]);

  // Phase 13 — the single coldest of the tracked muscle groups (never
  // trained counts as neglected), if its gap exceeds the threshold.
  const neglected = useMemo(
    () => mostNeglectedGroup(workouts, registryExercises, localDate(), NEGLECT_THRESHOLD_DAYS),
    [workouts, registryExercises]
  );
  const showNeglectBanner = !!neglected && neglected.group !== dismissedNeglect;

  // Default to the first group once the registry arrives (or if the selected
  // group was deleted elsewhere).
  useEffect(() => {
    if (groups.length && !groups.some((g) => g.name === selectedGroup)) {
      setSelectedGroup(groups[0].name);
    }
  }, [groups, selectedGroup]);

  const selected = exercises.find((e) => e.id === selectedId) ?? null;
  const visibleExercises = exercises.filter(
    (e) => primaryGroup(e) === selectedGroup
  );

  function handleStart() {
    setSession(startSession());
    setSelectedId(null);
    setLogged([]);
    setCounts.current = {};
    // lastWeight intentionally persists across sessions — it's a memory aid.
  }

  function handleEnd() {
    const n = logged.filter((l) => l.status === "saved").length;
    confirmDestructive(
      "End workout?",
      `${n} set${n === 1 ? "" : "s"} logged.`,
      "End",
      () => {
        setSession(null);
        setSelectedId(null);
      }
    );
  }

  function pickGroup(name: string) {
    setSelectedGroup(name);
    setPending(null);
    // Keep the selected exercise if it belongs to this group; otherwise clear.
    if (selected && primaryGroup(selected) !== name) setSelectedId(null);
  }

  function pickExercise(ex: Exercise) {
    setSelectedId(ex.id);
    if (ex.kind === "cardio") {
      const last = lastCardioSetByExercise.get(ex.name);
      setDuration(String(last ? last.duration : DEFAULT_DURATION));
      setDistance("");
      return;
    }
    const last = lastStrengthSetByExercise.get(ex.name);
    if (last) {
      setWeight(String(last.weight));
      setReps(String(last.reps));
    } else {
      const remembered = lastWeight.current[ex.name] ?? ex.lastWeight;
      if (remembered !== undefined) setWeight(String(remembered));
    }
  }

  async function submitGroup() {
    const name = newGroup.trim();
    if (!name) return;
    setNewGroup("");
    setAddingGroup(false);
    const existing = groups.find(
      (g) => g.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      pickGroup(existing.name);
      return;
    }
    const maxOrder = groups.reduce((m, g) => Math.max(m, g.order), 0);
    try {
      await addMuscleGroup(name, maxOrder + 1);
      setSelectedGroup(name);
    } catch (err) {
      notify("Couldn't add group", describe(err));
    }
  }

  // Typing a name and tapping Add: an existing exercise is just picked (its
  // group becomes selected); a new one opens the muscle-tagging card.
  function startAddExercise() {
    const name = custom.trim();
    if (!name || !selectedGroup) return;
    const existing = exercises.find(
      (e) => e.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      setCustom("");
      const grp = primaryGroup(existing);
      if (grp) setSelectedGroup(grp);
      pickExercise(existing);
      return;
    }
    setPending(name);
    setPendingSecondaries([]);
    setCustom("");
  }

  function toggleSecondary(name: string) {
    setPendingSecondaries((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    );
  }

  async function confirmAddExercise() {
    if (!pending || !selectedGroup) return;
    const muscles: MuscleCredit[] = [
      { group: selectedGroup, role: "primary", weight: 1.0 },
      ...pendingSecondaries.map(
        (g): MuscleCredit => ({
          group: g,
          role: "secondary",
          weight: SECONDARY_WEIGHT,
        })
      ),
    ];
    const name = pending;
    setPending(null);
    try {
      const id = await addExercise(name, muscles);
      setSelectedId(id);
    } catch (err) {
      notify("Couldn't add exercise", describe(err));
    }
  }

  function nudge(
    value: string,
    setValue: (s: string) => void,
    delta: number,
    integer: boolean
  ) {
    const cur = parseFloat(value);
    let next = (Number.isFinite(cur) ? cur : 0) + delta;
    if (next < 0) next = 0;
    setValue(integer ? String(Math.round(next)) : trimDecimal(next));
  }

  async function persist(entry: LoggedSet) {
    if (!session) return;
    setLogged((prev) =>
      prev.map((l) =>
        l.key === entry.key ? { ...l, status: "saving", error: undefined } : l
      )
    );
    try {
      if (entry.kind === "cardio") {
        await writeSet({
          date: session.date,
          session: session.id,
          exercise: entry.exercise,
          kind: "cardio",
          duration: entry.duration ?? 0,
          ...(entry.distance !== undefined ? { distance: entry.distance } : {}),
        });
      } else {
        await writeSet({
          date: session.date,
          session: session.id,
          exercise: entry.exercise,
          weight: entry.weight ?? 0,
          reps: entry.reps ?? 0,
          set: entry.set ?? 1,
        });
      }
      setLogged((prev) =>
        prev.map((l) => (l.key === entry.key ? { ...l, status: "saved" } : l))
      );
    } catch (err: unknown) {
      setLogged((prev) =>
        prev.map((l) =>
          l.key === entry.key
            ? { ...l, status: "error", error: describe(err) }
            : l
        )
      );
    }
  }

  function handleLog() {
    if (!session || !selected) return;
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    if (!(w > 0) || !(r > 0)) return; // guard; button is also disabled

    const setIndex = (setCounts.current[selected.name] ?? 0) + 1;
    setCounts.current[selected.name] = setIndex;
    lastWeight.current[selected.name] = w;
    // Persist the memory on the exercise doc (fire-and-forget — losing it only
    // costs a prefill, never a logged set).
    void setLastWeight(selected.id, w).catch(() => {});

    const entry: LoggedSet = {
      key: `k${keySeq.current++}`,
      exercise: selected.name,
      kind: "strength",
      weight: w,
      reps: r,
      set: setIndex,
      status: "saving",
    };
    setLogged((prev) => [entry, ...prev]);
    void persist(entry);

    // Phase 13 — tactile/visual confirmation only; never on the write's
    // critical path (fire-and-forget, guarded so web/unsupported platforms
    // no-op instead of throwing).
    triggerLogHaptic();
    animateLogButton();
  }

  // Cardio counterpart of handleLog: no set-index/lastWeight bookkeeping
  // (that memory is strength-only), just a duration (and optional distance)
  // write.
  function handleLogCardio() {
    if (!session || !selected) return;
    const d = parseInt(duration, 10);
    if (!(d > 0)) return; // guard; button is also disabled

    const distTrimmed = distance.trim();
    let dist: number | undefined;
    if (distTrimmed !== "") {
      const n = parseFloat(distTrimmed);
      if (Number.isFinite(n) && n > 0) dist = n;
    }

    const entry: LoggedSet = {
      key: `k${keySeq.current++}`,
      exercise: selected.name,
      kind: "cardio",
      duration: d,
      distance: dist,
      status: "saving",
    };
    setLogged((prev) => [entry, ...prev]);
    void persist(entry);

    triggerLogHaptic();
    animateLogButton();
  }

  function triggerLogHaptic() {
    if (Platform.OS === "web") return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      // Haptics unsupported on this device — no-op.
    }
  }

  function animateLogButton() {
    if (reduceMotion) return;
    logButtonScale.setValue(1);
    Animated.sequence([
      Animated.timing(logButtonScale, {
        toValue: 0.94,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.spring(logButtonScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 4,
        tension: 160,
      }),
    ]).start();
  }

  const isCardio = selected?.kind === "cardio";
  const parsedW = parseFloat(weight);
  const parsedR = parseInt(reps, 10);
  const canLog = !!session && !!selected && parsedW > 0 && parsedR > 0;
  const parsedD = parseInt(duration, 10);
  const canLogCardio = !!session && !!selected && parsedD > 0;
  const savedCount = logged.filter((l) => l.status === "saved").length;
  const lastStrengthSet = selected
    ? lastStrengthSetByExercise.get(selected.name)
    : undefined;
  const lastCardioSet = selected
    ? lastCardioSetByExercise.get(selected.name)
    : undefined;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Project Hercules</Text>
          {email && <Text style={styles.headerEmail}>{email}</Text>}
        </View>
        <Pressable
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
          onPress={onSignOut}
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {showNeglectBanner && neglected && (
        <NeglectBanner
          group={neglected.group}
          daysSince={neglected.daysSince}
          onTrain={() => pickGroup(neglected.group)}
          onDismiss={() => setDismissedNeglect(neglected.group)}
        />
      )}

      <ProgressCard
        progress={progress}
        hasWorkouts={workouts.length > 0}
        rank={workouts.length > 0 ? rankResult.rank : undefined}
        peakRankId={workouts.length > 0 ? rankResult.peakRankId : undefined}
        onPressMedallion={() => setLadderVisible(true)}
      />

      <Pressable
        style={({ pressed }) => [styles.restDayChip, pressed && styles.pressed]}
        onPress={() => setRestDayVisible(true)}
      >
        <Text style={styles.restDayChipText}>
          Rest day{vetoes.length > 0 ? ` · ${monthlyVetoCount} this month` : ""}
        </Text>
      </Pressable>

      {!session ? (
        <Pressable
          style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
          onPress={handleStart}
        >
          <Text style={styles.startText}>Start workout</Text>
        </Pressable>
      ) : (
        <>
          <View style={styles.sessionBar}>
            <View>
              <Text style={styles.sessionLabel}>SESSION</Text>
              <Text style={[styles.sessionId, tabularNums]}>{session.id}</Text>
            </View>
            <View style={styles.sessionRight}>
              <Text style={[styles.sessionCount, tabularNums]}>
                {savedCount} set{savedCount === 1 ? "" : "s"}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.endButton, pressed && styles.pressed]}
                onPress={handleEnd}
              >
                <Text style={styles.endText}>End</Text>
              </Pressable>
            </View>
          </View>

          {groups.length === 0 ? (
            <Text style={styles.loadingText}>Loading your exercises…</Text>
          ) : (
            <>
              <Text style={styles.sectionLabel}>MUSCLE GROUP</Text>
              <View style={styles.chipRow}>
                {groups.map((g) => {
                  const active = g.name === selectedGroup;
                  return (
                    <Pressable
                      key={g.id}
                      style={({ pressed }) => [
                        styles.groupChip,
                        active && styles.chipActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => pickGroup(g.name)}
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {g.name}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={({ pressed }) => [styles.groupChip, styles.addChip, pressed && styles.pressed]}
                  onPress={() => setAddingGroup((v) => !v)}
                >
                  <Text style={styles.chipText}>＋</Text>
                </Pressable>
              </View>

              {addingGroup && (
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.addInput}
                    value={newGroup}
                    onChangeText={setNewGroup}
                    placeholder="New muscle group…"
                    placeholderTextColor={colors.ink3}
                    returnKeyType="done"
                    onSubmitEditing={() => void submitGroup()}
                    autoFocus
                  />
                  <Pressable
                    style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                    onPress={() => void submitGroup()}
                  >
                    <Text style={styles.addButtonText}>Add</Text>
                  </Pressable>
                </View>
              )}

              <Text style={styles.sectionLabel}>
                EXERCISE{selectedGroup ? ` · ${selectedGroup}` : ""}
              </Text>
              <View style={styles.chipRow}>
                {visibleExercises.map((ex) => {
                  const active = ex.id === selectedId;
                  return (
                    <Pressable
                      key={ex.id}
                      style={({ pressed }) => [
                        styles.chip,
                        active && styles.chipActive,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => pickExercise(ex)}
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {ex.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {visibleExercises.length === 0 && (
                  <Text style={styles.emptyText}>
                    No exercises here yet — add one below.
                  </Text>
                )}
              </View>

              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={custom}
                  onChangeText={setCustom}
                  placeholder="Add exercise…"
                  placeholderTextColor={colors.ink3}
                  returnKeyType="done"
                  onSubmitEditing={startAddExercise}
                />
                <Pressable
                  style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
                  onPress={startAddExercise}
                >
                  <Text style={styles.addButtonText}>Add</Text>
                </Pressable>
              </View>

              {pending && selectedGroup && (
                <View style={styles.tagCard}>
                  <Text style={styles.selectedName}>{pending}</Text>
                  <Text style={styles.tagHint}>
                    Primary: {selectedGroup} · tap any other groups this also
                    works (half credit)
                  </Text>
                  <View style={styles.chipRow}>
                    {groups
                      .filter((g) => g.name !== selectedGroup)
                      .map((g) => {
                        const on = pendingSecondaries.includes(g.name);
                        return (
                          <Pressable
                            key={g.id}
                            style={({ pressed }) => [
                              styles.groupChip,
                              on && styles.chipActive,
                              pressed && styles.pressed,
                            ]}
                            onPress={() => toggleSecondary(g.name)}
                          >
                            <Text
                              style={[styles.chipText, on && styles.chipTextActive]}
                            >
                              {g.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                  </View>
                  <View style={styles.tagActions}>
                    <Pressable
                      style={({ pressed }) => [styles.endButton, pressed && styles.pressed]}
                      onPress={() => setPending(null)}
                    >
                      <Text style={styles.endText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.tagSaveButton, pressed && styles.pressed]}
                      onPress={() => void confirmAddExercise()}
                    >
                      <Text style={styles.logButtonText}>Save exercise</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </>
          )}

          {selected && !pending && isCardio && (
            <View style={styles.focalCard}>
              <View style={styles.focalEdge} />
              <Text style={styles.selectedName}>{selected.name}</Text>
              <Text style={styles.lastSetText}>
                {lastCardioSet ? (
                  <>
                    Last:{" "}
                    <Text style={[styles.lastSetValue, tabularNums]}>
                      {trimDecimal(lastCardioSet.duration)} min
                    </Text>
                  </>
                ) : (
                  "Last: —"
                )}
              </Text>

              <View style={styles.steps}>
                <Stepper
                  label="DURATION (MIN)"
                  value={duration}
                  onChangeText={setDuration}
                  onDecrement={() => nudge(duration, setDuration, -DURATION_STEP, true)}
                  onIncrement={() => nudge(duration, setDuration, DURATION_STEP, true)}
                />
              </View>

              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  value={distance}
                  onChangeText={setDistance}
                  placeholder="Distance (optional)"
                  placeholderTextColor={colors.ink3}
                  keyboardType="numeric"
                  returnKeyType="done"
                />
              </View>

              <Animated.View style={{ transform: [{ scale: logButtonScale }] }}>
                <Pressable
                  style={({ pressed }) => [
                    styles.logButton,
                    !canLogCardio && styles.logButtonDisabled,
                    canLogCardio && pressed && styles.pressed,
                  ]}
                  disabled={!canLogCardio}
                  onPress={handleLogCardio}
                >
                  <Text style={styles.logButtonText}>Log cardio</Text>
                </Pressable>
              </Animated.View>
            </View>
          )}

          {selected && !pending && !isCardio && (
            <View style={styles.focalCard}>
              <View style={styles.focalEdge} />
              <Text style={styles.selectedName}>{selected.name}</Text>
              <Text style={styles.lastSetText}>
                {lastStrengthSet ? (
                  <>
                    Last:{" "}
                    <Text style={[styles.lastSetValue, tabularNums]}>
                      {trimDecimal(lastStrengthSet.weight)} × {lastStrengthSet.reps}
                    </Text>
                  </>
                ) : (
                  "Last: —"
                )}
              </Text>

              <View style={styles.steps}>
                <Stepper
                  label="WEIGHT"
                  value={weight}
                  onChangeText={setWeight}
                  onDecrement={() => nudge(weight, setWeight, -WEIGHT_STEP, false)}
                  onIncrement={() => nudge(weight, setWeight, WEIGHT_STEP, false)}
                />
                <Stepper
                  label="REPS"
                  value={reps}
                  onChangeText={setReps}
                  onDecrement={() => nudge(reps, setReps, -REPS_STEP, true)}
                  onIncrement={() => nudge(reps, setReps, REPS_STEP, true)}
                />
              </View>

              <Animated.View style={{ transform: [{ scale: logButtonScale }] }}>
                <Pressable
                  style={({ pressed }) => [
                    styles.logButton,
                    !canLog && styles.logButtonDisabled,
                    canLog && pressed && styles.pressed,
                  ]}
                  disabled={!canLog}
                  onPress={handleLog}
                >
                  <Text style={styles.logButtonText}>
                    Log set {(setCounts.current[selected.name] ?? 0) + 1}
                  </Text>
                </Pressable>
              </Animated.View>
            </View>
          )}

          {logged.length > 0 && (
            <View style={styles.logList}>
              <Text style={styles.sectionLabel}>THIS SESSION</Text>
              {logged.map((l) => (
                <SessionRow
                  key={l.key}
                  entry={l}
                  reduceMotion={reduceMotion}
                  onRetry={() => void persist(l)}
                />
              ))}
            </View>
          )}
        </>
      )}
      </ScrollView>

      <LevelUpOverlay
        level={levelUpLevel}
        anim={overlayAnim}
        onDismiss={dismissLevelUp}
      />

      <RankMomentOverlay
        moment={rankMoment}
        anim={rankMomentAnim}
        onDismiss={dismissRankMoment}
      />

      <RankLadderModal visible={ladderVisible} onClose={() => setLadderVisible(false)} />

      <RestDayModal
        visible={restDayVisible}
        onClose={() => setRestDayVisible(false)}
        vetoes={vetoes}
      />
    </View>
  );
}

// Phase 13 — one "this session" row, wrapped so a freshly-logged set fades
// and scales in on mount instead of just popping into the list. Purely a
// mount-time flourish: the entry's own status (saving/saved/error) is
// unaffected, and reduceMotion renders it already at rest.
function SessionRow({
  entry,
  reduceMotion,
  onRetry,
}: {
  entry: LoggedSet;
  reduceMotion: boolean;
  onRetry: () => void;
}) {
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
    // Mount-only: this entry's key is unique per logged set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });

  return (
    <Animated.View style={[styles.logRow, { opacity: enter, transform: [{ scale }] }]}>
      <Text style={styles.logRowMain}>
        <Text style={styles.logRowName}>{entry.exercise}</Text>
        {" · "}
        <Text style={tabularNums}>
          {entry.kind === "cardio"
            ? `${trimDecimal(entry.duration ?? 0)} min`
            : `${trimDecimal(entry.weight ?? 0)} × ${entry.reps ?? 0}`}
        </Text>
      </Text>
      <View style={styles.logRowRight}>
        {entry.kind === "strength" && (
          <Text style={[styles.logRowSet, tabularNums]}>set {entry.set}</Text>
        )}
        {entry.status === "saving" && <Text style={styles.statusSaving}>saving…</Text>}
        {entry.status === "saved" && <Text style={styles.statusSaved}>✓</Text>}
        {entry.status === "error" && (
          <Pressable onPress={onRetry}>
            <Text style={styles.statusError}>retry ⟳</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

// Phase 13 — small, dismissible, theme-styled nudge toward the coldest of
// the tracked muscle groups. Read-only aside from the tap affordances:
// "train" hands the group off to the existing pickGroup (no new selection
// logic), and the ✕ dismisses just this group's banner until it changes.
function NeglectBanner({
  group,
  daysSince,
  onTrain,
  onDismiss,
}: {
  group: string;
  daysSince: number;
  onTrain: () => void;
  onDismiss: () => void;
}) {
  const message = Number.isFinite(daysSince)
    ? `${group} — ${describeGap(daysSince)} cold`
    : `${group} — never trained`;
  return (
    <View style={styles.neglectBanner}>
      <Text style={styles.neglectText}>{message}</Text>
      <View style={styles.neglectActions}>
        <Pressable
          style={({ pressed }) => [styles.neglectTrain, pressed && styles.pressed]}
          onPress={onTrain}
        >
          <Text style={styles.neglectTrainText}>Train →</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.neglectDismiss, pressed && styles.pressed]}
          onPress={onDismiss}
          hitSlop={8}
        >
          <Text style={styles.neglectDismissText}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Phase 13 — the level-up celebration: a brief Animated pop/fade overlay,
// auto-dismissing after ~2s or on tap. Renders nothing while `level` is
// null (no layout cost when hidden).
function LevelUpOverlay({
  level,
  anim,
  onDismiss,
}: {
  level: number | null;
  anim: Animated.Value;
  onDismiss: () => void;
}) {
  if (level === null) return null;
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  return (
    <Pressable style={styles.overlayBackdrop} onPress={onDismiss}>
      <Animated.View style={[styles.overlayCard, { opacity: anim, transform: [{ scale }] }]}>
        <Text style={styles.overlayCaption}>LEVEL UP</Text>
        <Text style={[styles.overlayLevel, tabularNums]}>{level}</Text>
        <Text style={styles.overlayHint}>Tap to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
}

// Rank-up / rank-slip celebration-or-somber overlay. Same full-screen
// backdrop/card mechanics as LevelUpOverlay (spring in, tap or ~2s
// auto-dismiss, reduceMotion instant), but with the medallion for the new
// rank and a tone that flips with `moment.kind`: rank-up mirrors the
// level-up's emerald accent-edged, lifted card; rank-slip drops the lift and
// the accent border for a flat, muted card with a dim caption — no confetti
// energy for a slip. Renders nothing while `moment` is null.
function RankMomentOverlay({
  moment,
  anim,
  onDismiss,
}: {
  moment: { kind: "up" | "slip"; rankId: number } | null;
  anim: Animated.Value;
  onDismiss: () => void;
}) {
  if (moment === null) return null;
  const isUp = moment.kind === "up";
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const label = labelForRankId(moment.rankId);
  return (
    <Pressable style={styles.overlayBackdrop} onPress={onDismiss}>
      <Animated.View
        style={[
          styles.overlayCard,
          isUp ? styles.rankUpCard : styles.rankSlipCard,
          { opacity: anim, transform: [{ scale }] },
        ]}
      >
        <View style={styles.overlayMedallion}>{medallionForRank(moment.rankId, 120)}</View>
        <Text style={isUp ? styles.overlayCaption : styles.rankSlipCaption}>
          {isUp ? "RANK UP" : "RANK LOST"}
        </Text>
        <Text style={isUp ? styles.rankUpLabel : styles.rankSlipLabel}>
          {isUp ? label : `You slipped to ${label}`}
        </Text>
        <Text style={styles.overlayHint}>Tap to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
}

function Stepper({
  label,
  value,
  onChangeText,
  onDecrement,
  onIncrement,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          onPress={onDecrement}
        >
          <Text style={styles.stepButtonText}>−</Text>
        </Pressable>
        <TextInput
          style={[styles.stepValue, tabularNums]}
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          selectTextOnFocus
        />
        <Pressable
          style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
          onPress={onIncrement}
        >
          <Text style={styles.stepButtonText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Format a number with at most one decimal, dropping a trailing ".0".
function trimDecimal(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// True if `a` was logged after `b`, ordered by (date, session, set) — see the
// lastStrengthSetByExercise/lastCardioSetByExercise comment above for why
// this triple stands in for a timestamp.
function isMoreRecent(a: WorkoutSet, b: WorkoutSet): boolean {
  if (a.date !== b.date) return a.date > b.date;
  if (a.session !== b.session) return a.session > b.session;
  return (a.set ?? 0) > (b.set ?? 0);
}

// Kind guards mirroring progress.ts's own isStrengthSet contract: a workout
// doc survives workouts.ts's toWorkoutSet seam with weight/reps guaranteed
// finite for strength and duration guaranteed finite for cardio, so these
// narrow safely, not just conveniently.
function isStrengthWorkoutSet(w: WorkoutSet): w is StrengthWorkoutSet {
  return w.kind !== "cardio";
}
function isCardioWorkoutSet(w: WorkoutSet): w is CardioWorkoutSet {
  return w.kind === "cardio";
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingTop: TOP_PAD,
    paddingHorizontal: space.x4,
    paddingBottom: space.x10 + space.x6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: space.x4,
  },
  headerLeft: { flex: 1 },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  headerEmail: { color: colors.ink3, fontSize: 12, marginTop: 2 },
  signOutButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.button - 4,
  },
  signOutText: { color: colors.ink2, fontSize: 13, fontWeight: "600" },

  startButton: {
    backgroundColor: colors.accent,
    paddingVertical: 28,
    borderRadius: radius.buttonLg,
    alignItems: "center",
    marginTop: space.x6,
  },
  startText: { color: colors.accentInk, fontSize: 22, fontWeight: "800" },

  // Discreet rest-day affordance, sitting right under the streak/rank
  // ProgressCard — a small self-width chip, not a full-bleed row, so it
  // doesn't compete with the start-workout CTA.
  restDayChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingVertical: 7,
    paddingHorizontal: 12,
    marginTop: space.x3,
  },
  restDayChipText: { color: colors.ink3, fontSize: 12.5, fontWeight: "600" },

  sessionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.button,
    padding: space.x3 + 2,
    marginBottom: space.x5 - 2,
  },
  sessionLabel: { ...type.label, fontSize: 10.5, color: colors.ink3 },
  sessionId: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },
  sessionRight: { flexDirection: "row", alignItems: "center", gap: space.x3 },
  sessionCount: { color: colors.ink2, fontSize: 12, fontWeight: "600" },
  endButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: radius.button - 4,
  },
  endText: { color: colors.ink2, fontSize: 13, fontWeight: "700" },

  sectionLabel: {
    ...type.label,
    color: colors.ink3,
    marginBottom: space.x2,
    marginTop: space.x1,
  },
  loadingText: { color: colors.ink2, fontSize: 15, marginTop: space.x2 },
  emptyText: { color: colors.ink3, fontSize: 14, paddingVertical: space.x2 },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.x2 - 1,
    marginBottom: space.x4,
  },
  chip: {
    backgroundColor: colors.raised,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  groupChip: {
    backgroundColor: colors.raised,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  addChip: { paddingHorizontal: 12 },
  chipActive: {
    borderColor: colors.accentLine,
    backgroundColor: colors.accentTint,
  },
  chipText: { color: colors.ink2, fontSize: 13.5, fontWeight: "600" },
  chipTextActive: { color: colors.accent },

  addRow: { flexDirection: "row", gap: space.x2, marginBottom: space.x3 },
  addInput: {
    flex: 1,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.ink,
    fontSize: 15,
  },
  addButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  addButtonText: { color: colors.ink2, fontSize: 15, fontWeight: "600" },

  // Non-focal raised card — used only by the muscle-tagging flow while
  // adding a new exercise. Deliberately plain (no accent edge/lift) so the
  // one focal element on screen stays the actual set-logging card below.
  tagCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.x4,
    marginTop: space.x4,
  },

  // The focal Log card: accent-edged, lifted above the rest of the screen.
  // The mockup's card background is a subtle vertical gradient
  // (#16283a -> #131f2e); RN has no gradient primitive without a new
  // dependency, so this is approximated with a solid `raised` fill.
  focalCard: {
    position: "relative",
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.card,
    padding: space.x4,
    marginTop: space.x4,
    overflow: "hidden",
    ...lift,
  },
  focalEdge: {
    position: "absolute",
    left: 0,
    top: 14,
    bottom: 14,
    width: 3,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  selectedName: {
    ...type.title,
    color: colors.ink,
    marginBottom: 4,
  },
  // Pulled up under selectedName (shared by the log card and the pending
  // add-exercise card, which doesn't render this line) rather than shrinking
  // selectedName's own margin, so the tagging card's layout is untouched.
  lastSetText: { color: colors.ink3, fontSize: 12.5, marginBottom: space.x3 },
  lastSetValue: { color: colors.ink2, fontWeight: "700" },
  tagHint: { color: colors.ink2, fontSize: 13, marginBottom: space.x2 + 2 },
  tagActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: space.x2 + 2,
    marginTop: space.x1,
  },
  tagSaveButton: {
    backgroundColor: colors.accent,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radius.chip,
    alignItems: "center",
  },

  steps: { flexDirection: "row", gap: space.x3, marginBottom: space.x1 },
  stepper: { flex: 1, marginBottom: space.x3 + 2 },
  stepperLabel: {
    ...type.label,
    fontSize: 10.5,
    color: colors.ink3,
    marginBottom: 7,
  },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: space.x3 - 1 },
  stepButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line2,
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonText: { color: colors.ink, fontSize: 28, fontWeight: "700" },
  stepValue: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    height: 56,
    textAlign: "center",
    color: colors.ink,
    fontSize: 24,
    fontWeight: "700",
  },

  logButton: {
    backgroundColor: colors.accent,
    paddingVertical: 20,
    borderRadius: radius.buttonLg,
    alignItems: "center",
    marginTop: space.x1 + 2,
  },
  logButtonDisabled: { backgroundColor: colors.raised },
  logButtonText: { color: colors.accentInk, fontSize: 18, fontWeight: "800" },

  logList: { marginTop: space.x6 },
  logRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.chip,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: space.x2,
  },
  logRowMain: { color: colors.ink, fontSize: 14, flex: 1 },
  logRowName: { fontWeight: "700" },
  logRowRight: { flexDirection: "row", alignItems: "center", gap: space.x3 - 2 },
  logRowSet: { color: colors.ink3, fontSize: 12 },
  statusSaving: { color: colors.amber, fontSize: 12, fontWeight: "600" },
  statusSaved: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  statusError: { color: colors.danger, fontSize: 14, fontWeight: "600" },

  // Phase 13 — neglect nudge banner.
  neglectBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radius.chip,
    paddingVertical: space.x2 + 2,
    paddingHorizontal: space.x3,
    marginBottom: space.x4,
  },
  neglectText: { color: colors.ink2, fontSize: 13, fontWeight: "600", flex: 1 },
  neglectActions: { flexDirection: "row", alignItems: "center", gap: space.x2 + 2 },
  neglectTrain: {
    backgroundColor: colors.accentTint,
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.chip - 3,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  neglectTrainText: { color: colors.accent, fontSize: 12.5, fontWeight: "700" },
  neglectDismiss: { padding: 4 },
  neglectDismissText: { color: colors.ink3, fontSize: 14, fontWeight: "700" },

  // Phase 13 — level-up overlay.
  overlayBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(4,8,14,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: space.x6,
  },
  overlayCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.card,
    paddingVertical: space.x8,
    paddingHorizontal: space.x10,
    alignItems: "center",
    ...lift,
  },
  overlayCaption: {
    ...type.label,
    color: colors.accent,
    marginBottom: space.x2,
  },
  overlayLevel: {
    ...type.display,
    fontSize: 56,
    lineHeight: 60,
    color: colors.ink,
  },
  overlayHint: { color: colors.ink3, fontSize: 12, marginTop: space.x3 },

  // Rank moments — up mirrors the level-up card's accent-lifted look; slip
  // drops the accent border and the lift shadow for a flat, muted card so
  // the two read as distinctly different tones at a glance.
  overlayMedallion: { marginBottom: space.x3 },
  rankUpCard: {
    borderColor: colors.accentLine,
  },
  rankSlipCard: {
    borderColor: colors.line2,
    elevation: 0,
    shadowOpacity: 0,
  },
  rankSlipCaption: {
    ...type.label,
    color: colors.ink3,
    marginBottom: space.x2,
  },
  rankUpLabel: {
    ...type.title,
    color: colors.ink,
    marginTop: space.x1,
  },
  rankSlipLabel: {
    ...type.title,
    color: colors.ink2,
    marginTop: space.x1,
  },

  pressed: { opacity: 0.7 },
});
