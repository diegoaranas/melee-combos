// Export the clip -> replay matches as a CSV and as a Dolphin playback queue.
const fs = require("fs");
const rows = require("./data/clipped_combos.json");

const CHARS = require("@slippi/slippi-js").characters;
const charName = (id) => (id == null ? "" : CHARS.getCharacterShortName(id));
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v ?? "");

const header = ["clip", "replay", "startFrame", "endFrame", "players", "damage", "kill", "hits", "fromPercent", "clippi"];
const lines = [header.join(",")];
for (const r of rows) {
  const m = r.main;
  let verdict = m ? (m.reject ? `rejects (${m.reject})` : "keeps") : "no punish by me";
  lines.push(
    [r.clip, r.replay, r.startFrame, r.endFrame, r.players, m?.dmg, m?.kill, m?.hits, m?.sp, verdict].map(csvCell).join(",")
  );
}
fs.writeFileSync("out/clipped_combos.csv", lines.join("\n") + "\n");

// Dolphin queue: the same JSON format Project Clippi writes (mode "queue").
const queue = {
  mode: "queue",
  replay: "",
  isRealTimeMode: false,
  outputOverlayFiles: true,
  queue: rows.map((r) => ({
    path: r.replay,
    startFrame: Math.max(-123, r.startFrame - 60),
    endFrame: r.endFrame + 60,
    gameStartAt: r.startAt,
    gameStation: "",
  })),
};
fs.writeFileSync("out/queue_clipped.json", JSON.stringify(queue, null, 1));
console.log(`wrote ${rows.length} rows; e.g. ${charName(2)}`);
