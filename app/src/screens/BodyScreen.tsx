// Phase 11 — the muscle-group body-map. Read-only: it watches the same
// Firestore collections LogScreen does, feeds them through the unmodified
// Phase 9 engine (progress.ts), and paints the resulting per-group LEVELs
// onto an SVG body via react-native-body-highlighter. No writes, no engine
// changes — this screen only ever reads `progress.perGroup`.
import { useEffect, useMemo, useState } from "react";
import {
  Platform,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Body, { type ExtendedBodyPart } from "react-native-body-highlighter";

import {
  buildBodyData,
  colorForLevel,
  COLORS,
  getMaxLevel,
  groupForSlug,
  NEGLECTED,
  UNMAPPED_FILL,
} from "../muscleMap";
import {
  computeProgress,
  type RegistryExercise,
  type RegistryGroup,
  type WorkoutSet,
} from "../progress";
import {
  watchExercises,
  watchMuscleGroups,
  type Exercise,
  type MuscleGroup,
} from "../registry";
import { localDate } from "../session";
import { watchVetoes } from "../vetoes";
import { watchWorkouts } from "../workouts";
import { colors, radius, space, tabularNums, type } from "../theme";

const FIGURE_BASE_W = 200; // react-native-body-highlighter's unscaled width
const FIGURE_BASE_H = 400;

export default function BodyScreen() {
  const [groups, setGroups] = useState<MuscleGroup[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutSet[]>([]);
  const [vetoes, setVetoes] = useState<string[]>([]);
  const [selected, setSelected] = useState<{ group: string; level: number } | null>(
    null
  );
  const { width } = useWindowDimensions();

  useEffect(() => {
    const unsubGroups = watchMuscleGroups(setGroups);
    const unsubExercises = watchExercises(setExercises);
    const unsubWorkouts = watchWorkouts(setWorkouts);
    const unsubVetoes = watchVetoes(setVetoes);
    return () => {
      unsubGroups();
      unsubExercises();
      unsubWorkouts();
      unsubVetoes();
    };
  }, []);

  // Same shape-mapping LogScreen does — computeProgress mirrors registry.ts's
  // types rather than importing them (see progress.ts's header comment).
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

  const perGroup = progress.perGroup;
  const hasData = workouts.length > 0;
  const bodyData: ExtendedBodyPart[] = useMemo(
    () => buildBodyData(perGroup),
    [perGroup]
  );
  const maxLevel = useMemo(() => getMaxLevel(perGroup), [perGroup]);

  const levelRows = useMemo(
    () =>
      Object.entries(perGroup)
        .map(([name, g]) => ({ name, level: g.level }))
        .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    [perGroup]
  );

  function handlePress(part: ExtendedBodyPart) {
    const group = groupForSlug(part.slug);
    if (!group) return;
    setSelected({ group, level: perGroup[group]?.level ?? 0 });
  }

  // Two 200x400-unit figures side by side need roughly 2*200*scale + gap of
  // horizontal room; below that, stack them in the scroll view instead.
  const contentW = width - space.x4 * 2;
  const gap = space.x4;
  const sideBySide = contentW >= (FIGURE_BASE_W * 2 * 0.72 + gap);
  const scale = sideBySide
    ? Math.min(1.05, (contentW - gap) / 2 / FIGURE_BASE_W)
    : Math.min(1.35, contentW / FIGURE_BASE_W);

  const bodyProps = {
    data: bodyData,
    colors: COLORS as string[],
    border: "none" as const,
    defaultFill: UNMAPPED_FILL,
    defaultStroke: colors.line,
    defaultStrokeWidth: 1,
    onBodyPartPress: handlePress,
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Body map</Text>
      <Text style={styles.subtitle}>
        Tinted by trained level — cold and untouched, or hot and dialed in.
      </Text>

      {!hasData && (
        <View style={styles.hintCard}>
          <Text style={styles.hintText}>
            Log sessions to light up the map.
          </Text>
        </View>
      )}

      <View
        style={[
          styles.figures,
          sideBySide ? styles.figuresRow : styles.figuresColumn,
        ]}
      >
        <View style={styles.figureBox}>
          <Text style={styles.figureLabel}>FRONT</Text>
          <Body {...bodyProps} side="front" scale={scale} />
        </View>
        <View style={styles.figureBox}>
          <Text style={styles.figureLabel}>BACK</Text>
          <Body {...bodyProps} side="back" scale={scale} />
        </View>
      </View>

      {selected && (
        <View style={styles.selectedCard}>
          <View
            style={[
              styles.selectedDot,
              { backgroundColor: colorForLevel(selected.level, maxLevel) },
            ]}
          />
          <Text style={styles.selectedText}>
            {selected.group} ·{" "}
            <Text style={tabularNums}>
              {selected.level > 0 ? `Lv ${selected.level}` : "untrained"}
            </Text>
          </Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>LEGEND</Text>
      <View style={styles.legendRow}>
        <LegendSwatch color={NEGLECTED} label="neglected" />
        <LegendSwatch color={COLORS[0]} label="cold" />
        <LegendSwatch color={COLORS[Math.floor(COLORS.length / 2)]} label="warming" />
        <LegendSwatch color={COLORS[COLORS.length - 1]} label="hot" />
      </View>

      <Text style={styles.sectionLabel}>GROUP LEVELS</Text>
      <View style={styles.levelList}>
        {levelRows.map((row) => {
          const trained = row.level > 0;
          return (
            <View key={row.name} style={styles.levelRow}>
              <View style={styles.levelLeft}>
                <View
                  style={[
                    styles.levelDot,
                    { backgroundColor: colorForLevel(row.level, maxLevel) },
                  ]}
                />
                <Text
                  style={[styles.levelName, !trained && styles.levelNameMuted]}
                >
                  {row.name}
                </Text>
              </View>
              <Text
                style={[
                  styles.levelValue,
                  tabularNums,
                  !trained && styles.levelValueMuted,
                ]}
              >
                {trained ? `Lv ${row.level}` : "—"}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const TOP_PAD =
  Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) + 8 : 52;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingTop: TOP_PAD,
    paddingHorizontal: space.x4,
    paddingBottom: space.x10 + space.x6,
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginTop: space.x2,
  },
  subtitle: { color: colors.ink3, fontSize: 13, marginTop: 2, marginBottom: space.x4 },

  hintCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.x4,
    marginBottom: space.x4,
  },
  hintText: { color: colors.ink2, fontSize: 14 },

  figures: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    padding: space.x4,
    marginBottom: space.x4,
    alignItems: "center",
  },
  figuresRow: { flexDirection: "row", justifyContent: "center", gap: space.x4 },
  figuresColumn: { flexDirection: "column", gap: space.x3 },
  figureBox: { alignItems: "center" },
  figureLabel: {
    ...type.label,
    fontSize: 10,
    color: colors.ink3,
    marginBottom: space.x2 - 2,
  },

  selectedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.x2,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.chip,
    paddingVertical: space.x2 + 2,
    paddingHorizontal: space.x3,
    marginBottom: space.x4,
  },
  selectedDot: { width: 10, height: 10, borderRadius: 5 },
  selectedText: { color: colors.ink, fontSize: 14, fontWeight: "700" },

  sectionLabel: {
    ...type.label,
    color: colors.ink3,
    marginBottom: space.x2,
    marginTop: space.x1,
  },

  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.x4,
    marginBottom: space.x4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { color: colors.ink2, fontSize: 12.5, fontWeight: "600" },

  levelList: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  levelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.x3 - 1,
    paddingHorizontal: space.x4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  levelLeft: { flexDirection: "row", alignItems: "center", gap: space.x2 + 2 },
  levelDot: { width: 10, height: 10, borderRadius: 5 },
  levelName: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  levelNameMuted: { color: colors.ink3, fontWeight: "500" },
  levelValue: { color: colors.ink2, fontSize: 13.5, fontWeight: "700" },
  levelValueMuted: { color: colors.ink3, fontWeight: "500" },
});
