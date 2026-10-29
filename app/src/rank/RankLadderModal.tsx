// A faithful in-app echo of the approved `Medallions v2.dc.html` preview:
// all 21 medallions (real react-native-svg renders, via RankMedallion), each
// with its tier name, material (uppercase, letterspaced, like the
// artifact's material caption), division pips (or "Apex" for Kratos),
// "enters at N XP", the aura label, and the copy line. Opened by tapping the
// medallion on ProgressCard. Read-only — no rank logic lives here, just a
// listing.
import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { XP_PER_DIVISION, TIERS } from "./rankLadder";
import { MEDALLION_ART } from "./medallionArt";
import RankMedallion from "./RankMedallion";
import { colors, radius, space, tabularNums, type } from "../theme";

// "Enters at N XP" is each tier's III-division threshold: tier index * one
// tier's worth of XP (3 divisions * XP_PER_DIVISION) — mirrors the
// artifact's `i*450` using the live constant instead of the baked-in number.
const XP_PER_TIER = XP_PER_DIVISION * 3;

export default function RankLadderModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>The Rank Ladder</Text>
            <Pressable style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]} onPress={onClose} hitSlop={8}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {TIERS.map((tier, i) => {
              const art = MEDALLION_ART[i];
              const isApex = !!tier.apex;
              // Pip/division-dot color: the material's lightest face tone —
              // matches the artifact's `<span style="background:<light>">`.
              const pipColor = art.face.gradient.stops[0]?.color ?? colors.ink2;
              return (
                <View key={tier.name} style={styles.row}>
                  <Text style={[styles.idx, tabularNums]}>
                    {String(i + 1).padStart(2, "0")} / {TIERS.length}
                  </Text>
                  <View style={styles.medallionWrap}>
                    <RankMedallion art={art} size={64} />
                  </View>
                  <View style={styles.info}>
                    <Text style={styles.tierName}>{tier.name}</Text>
                    <Text style={styles.material}>{art.material}</Text>
                    {isApex ? (
                      <Text style={styles.apexLabel}>Apex — no divisions</Text>
                    ) : (
                      <View style={styles.pips}>
                        {[0, 1, 2].map((p) => (
                          <View key={p} style={[styles.pip, { backgroundColor: pipColor }]} />
                        ))}
                      </View>
                    )}
                    <Text style={[styles.meta, tabularNums]}>
                      enters at <Text style={styles.metaValue}>{(i * XP_PER_TIER).toLocaleString()}</Text> XP
                    </Text>
                    <Text style={styles.copy}>“{tier.copy}”</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
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
    maxHeight: "88%",
    paddingBottom: space.x4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: space.x4,
    paddingTop: space.x4,
    paddingBottom: space.x3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: { ...type.title, color: colors.ink },
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
  scrollContent: { paddingTop: space.x3, paddingBottom: space.x6 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.x3,
    paddingVertical: space.x3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  idx: {
    width: 44,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: colors.ink3,
  },
  medallionWrap: { alignItems: "center", justifyContent: "center" },
  info: { flex: 1, minWidth: 0 },
  tierName: { ...type.title, fontSize: 17, color: colors.ink, marginBottom: 1 },
  material: {
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.ink3,
    marginBottom: 6,
  },
  apexLabel: {
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.accent,
    marginBottom: 6,
  },
  pips: { flexDirection: "row", gap: 6, marginBottom: 6 },
  pip: { width: 7, height: 7, transform: [{ rotate: "45deg" }] },
  meta: { fontSize: 11.5, color: colors.ink3 },
  metaValue: { color: colors.ink2, fontWeight: "700" },
  copy: {
    fontSize: 11.5,
    color: colors.ink3,
    fontStyle: "italic",
    marginTop: 6,
  },

  pressed: { opacity: 0.7 },
});
