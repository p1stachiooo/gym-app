// One-off dump script (Phase-desktop-medallions parity, mirrors the existing
// body_paths.json convention documented in desktop/bodymap.py): resolves
// medallionArt.ts's builder-function calls (S/linear/rimPolygon/faceGrad/...)
// into plain JSON so desktop/medallions.py can consume the exact same
// literals without re-implementing the builders in Python. Not part of the
// app build — run once via `npx tsx scripts/dump_medallion_art.ts` from
// app/, output copied to desktop/medallion_art.json.
import fs from "fs";
import path from "path";
import { MEDALLION_ART } from "../src/rank/medallionArt";

const outPath = path.resolve(__dirname, "../../desktop/medallion_art.json");
fs.writeFileSync(outPath, JSON.stringify(MEDALLION_ART, null, 2), "utf-8");
console.log(`Wrote ${MEDALLION_ART.length} tiers to ${outPath}`);
