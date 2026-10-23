// For each matched clip, find the user's punish(es) inside the clip window and whether Clippi keeps them.
const fs = require("fs");
const matches = require("./data/matches.json").filter((m) => m.replay);
const punishes = JSON.parse(fs.readFileSync("data/punishes_mine.json", "utf8"));

const rows = [];
for (const m of matches) {
  const inGame = punishes.filter((p) => p.file === m.replay);
  // Punishes overlapping the clip; the clipped one is usually the biggest.
  const overlap = inGame
    .filter((p) => p.e >= m.startFrame && p.s <= m.endFrame)
    .sort((a, b) => b.dmg - a.dmg);
  const main = overlap[0];
  rows.push({ ...m, main, others: overlap.slice(1) });
  const desc = main
    ? `${main.dmg}% ${main.kill ? "KILL" : "no-kill"} ${main.hits} hits from ${main.sp}% [${main.open}] -> ${main.reject ? "clippi rejects: " + main.reject : "CLIPPI KEEPS"}`
    : "no punish by me in window";
  console.log(String(m.id).padStart(2), desc);
}
fs.writeFileSync("data/clipped_combos.json", JSON.stringify(rows, null, 1));
const kept = rows.filter((r) => r.main && !r.main.reject).length;
console.log(`\nClippi keeps ${kept}/${rows.length} clipped combos`);
