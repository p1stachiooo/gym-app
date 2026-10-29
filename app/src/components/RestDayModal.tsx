// Rest-day / excuse control MVP. A themed bottom-sheet Modal (mirrors
// RankLadderModal's backdrop/sheet mechanics) that lets the user mark today
// as a rest day and see/undo this month's marked rest days. Reads `vetoes`
// (all-time, sorted date strings) from the parent — LogScreen/BodyScreen
// already watch it via vetoes.ts's watchVetoes — and calls addVeto/removeVeto
// directly; the list updates itself via that same live watcher, so this
// component holds no vetoes state of its own, only local UI (saving/error)
// state. Does NOT enforce the VETO_DAYS_PER_MONTH cap — that's the engine's
// job (progress.ts's enforceVetoCap); this just informs the user when they've
// hit or passed it.
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { notify } from "../alerts";
import { DEFAULT_PARAMS } from "../progress";
import { localDate } from "../session";
import { addVeto, removeVeto } from "../vetoes";
import { colors, radius, space, tabularNums, type } from "../theme";

const CAP = DEFAULT_PARAMS.VETO_DAYS_PER_MONTH;

function monthOf(date: string): string {
  return date.slice(0, 7); // "YYYY-MM-DD" -> "YYYY-MM"
}

// "2026-06-30" -> "Jun 30" — short, locale-stable, no Date/timezone parsing
// needed for a plain "YYYY-MM-DD" string.
const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatShort(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

export default function RestDayModal({
  visible,
  onClose,
  vetoes,
}: {
  visible: boolean;
  onClose: () => void;
  vetoes: string[];
}) {
  const [marking, setMarking] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const today = localDate();
  const thisMonth = monthOf(today);
  const monthVetoes = vetoes.filter((d) => monthOf(d) === thisMonth).sort();
  const usedCount = monthVetoes.length;
  const alreadyMarkedToday = vetoes.includes(today);
  const atOrOverCap = usedCount >= CAP;

  async function handleMarkToday() {
    if (marking || alreadyMarkedToday) return;
    setMarking(true);
    try {
      await addVeto(today);
    } catch (err) {
      notify("Couldn't mark rest day", describe(err));
    } finally {
      setMarking(false);
    }
  }

  async function handleRemove(date: string) {
    if (removing) return;
    setRemoving(date);
    try {
      await removeVeto(date);
    } catch (err) {
      notify("Couldn't remove rest day", describe(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Rest days</Text>
              <Text style={[styles.subtitle, tabularNums]}>
                {usedCount} of {CAP} used this month
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              onPress={onClose}
              hitSlop={8}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              style={({ pressed }) => [
                styles.markButton,
                (alreadyMarkedToday || marking) && styles.markButtonDisabled,
                !alreadyMarkedToday && !marking && pressed && styles.pressed,
              ]}
              disabled={alreadyMarkedToday || marking}
              onPress={() => void handleMarkToday()}
            >
              <Text style={styles.markButtonText}>
                {alreadyMarkedToday
                  ? "Today is already a rest day"
                  : marking
                  ? "Marking…"
                  : "Mark today as a rest day"}
              </Text>
            </Pressable>

            {atOrOverCap && (
              <Text style={styles.capNote}>
                You've used all {CAP} rest days this month — extra ones won't
                count toward your consistency budget, but you can still mark
                them.
              </Text>
            )}

            <Text style={styles.sectionLabel}>THIS MONTH</Text>
            {monthVetoes.length === 0 ? (
              <Text style={styles.emptyText}>No rest days marked yet.</Text>
            ) : (
              <View style={styles.list}>
                {monthVetoes.map((date, i) => (
                  <View
                    key={date}
                    style={[
                      styles.row,
                      i >= CAP && styles.rowOverCap,
                    ]}
                  >
                    <Text style={styles.rowDate}>{formatShort(date)}</Text>
                    <Pressable
                      style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                      onPress={() => void handleRemove(date)}
                      disabled={removing === date}
                      hitSlop={8}
                    >
                      <Text style={styles.removeText}>
                        {removing === date ? "…" : "✕"}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(4,8,14,0.72)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    maxHeight: "80%",
    paddingBottom: space.x4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: space.x4,
    paddingTop: space.x4,
    paddingBottom: space.x3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { ...type.title, color: colors.ink },
  subtitle: { color: colors.ink3, fontSize: 12.5, marginTop: 3 },
  closeButton: {
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.button - 4,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  closeText: { color: colors.ink2, fontSize: 14, fontWeight: "700" },

  scroll: { paddingHorizontal: space.x4 },
  scrollContent: { paddingTop: space.x4, paddingBottom: space.x6 },

  markButton: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: radius.buttonLg,
    alignItems: "center",
    marginBottom: space.x3,
  },
  markButtonDisabled: { backgroundColor: colors.raised },
  markButtonText: { color: colors.accentInk, fontSize: 16, fontWeight: "800" },

  capNote: {
    color: colors.amber,
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: space.x4,
  },

  sectionLabel: {
    ...type.label,
    color: colors.ink3,
    marginBottom: space.x2,
  },
  emptyText: { color: colors.ink3, fontSize: 14, paddingVertical: space.x2 },

  list: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: space.x3 - 1,
    paddingHorizontal: space.x4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // Rest days beyond the monthly cap (index >= CAP within the sorted list)
  // are visually dimmed — still shown/removable, just informationally
  // outside what the engine will credit.
  rowOverCap: { opacity: 0.5 },
  rowDate: { color: colors.ink, fontSize: 14, fontWeight: "600" },
  removeButton: { padding: 4 },
  removeText: { color: colors.ink3, fontSize: 14, fontWeight: "700" },

  pressed: { opacity: 0.7 },
});
