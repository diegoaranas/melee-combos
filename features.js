// Build a feature table for every punish where the user is the attacker.
// Output: data/features.csv (one row per punish), with label=1 for clipped punishes.
const fs = require("fs");

const USER_CODE = "1SHINE#0";
const GAME_END = { TIME: 1, GAME: 2, NO_CONTEST: 7 };

const games = fs.readdirSync("data").filter((f) => /^index_\d+\.jsonl$/.test(f))
  .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).map(JSON.parse))
  .filter((g) => g.conversions);

const clipped = new Set(
  require("./data/clipped_combos.json").filter((r) => r.main).map((r) => `${r.replay}|${r.main.s}`)
);
// Rage-quit clips have no closed punish; label the open punish in that clip's window instead.
const clipWindows = require("./data/clipped_combos.json").map((r) => r);

// Move ids from slippi-js `moves`.
const AERIALS = [13, 14, 15, 16, 17];
const SMASHES = [10, 11, 12];
const THROWS = [53, 54, 55, 56];
const GRABBY = [52, ...THROWS];
const DOWN_B = 21;

function moveFeatures(moves) {
  const ids = moves.map((m) => m[0]);
  const n = Math.max(1, ids.length);
  const frac = (set) => ids.filter((i) => set.includes(i)).length / n;
  const gaps = moves.slice(1).map((m, i) => m[1] - moves[i][1]);
  const counts = {};
  for (const i of ids) counts[i] = (counts[i] || 0) + 1;
  const last = ids[ids.length - 1];
  return {
    maxGap: gaps.length ? Math.max(...gaps) : 0,
    meanGap: gaps.length ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : 0,
    aerialFrac: frac(AERIALS).toFixed(2),
    smashFrac: frac(SMASHES).toFixed(2),
    grabFrac: frac(GRABBY).toFixed(2),
    downBFrac: frac([DOWN_B]).toFixed(2),
    repeatFrac: (Math.max(0, ...Object.values(counts)) / n).toFixed(2),
    killAerial: AERIALS.includes(last) ? 1 : 0,
    killSmash: SMASHES.includes(last) ? 1 : 0,
    killDownB: last === DOWN_B ? 1 : 0,
    killThrow: THROWS.includes(last) ? 1 : 0,
  };
}

const cols = [
  "id", "file", "s", "e", "me", "them", "stage", "opponent", "label",
  "dmg", "hits", "distinct", "sp", "ep", "kill", "zeroToDeath", "ragequit", "gameWinner",
  "seconds", "hitsPerSec", "maxHitShare", "neutralWin", "lastMove", "singles",
  "maxGap", "meanGap", "aerialFrac", "smashFrac", "grabFrac", "downBFrac", "repeatFrac",
  "killAerial", "killSmash", "killDownB", "killThrow",
];
const out = [cols.join(",")];
let id = 0;

for (const g of games) {
  const me = g.players.find((p) => p.code === USER_CODE);
  if (!me) continue;
  const singles = g.players.length === 2 && !g.isTeams ? 1 : 0;
  const lastFrame = g.lastFrame ?? 0;
  const mine = g.conversions.filter((c) => c.opp === me.idx);
  for (const c of mine) {
    const victim = g.players.find((p) => p.idx === c.p);
    if (!victim || victim.type === 1) continue; // skip CPUs
    const open = c.e == null;
    const e = open ? lastFrame : c.e;
    const moveDmg = c.moves.reduce((a, m) => a + m[2], 0);
    const dmg = open ? moveDmg : c.ep - c.sp;
    const ep = open ? c.sp + moveDmg : c.ep;
    const ragequit = open && g.gameEnd && g.gameEnd.method === GAME_END.NO_CONTEST && g.gameEnd.lras === victim.idx ? 1 : 0;
    const laterKill = g.conversions.some((o) => o.p === c.p && o.kill && o.s > c.s);
    const myPlace = g.gameEnd?.placements?.find((p) => p.playerIndex === me.idx)?.position;
    const gameWinner = c.kill && !laterKill && g.gameEnd?.method === GAME_END.GAME && myPlace === 0 ? 1 : 0;
    const seconds = Math.max(1, e - c.s) / 60;
    const hits = c.moves.length;
    let label = clipped.has(`${g.file}|${c.s}`) ? 1 : 0;
    if (!label && open && clipWindows.some((r) => !r.main && r.replay === g.file && c.s <= r.endFrame && e >= r.startFrame)) label = 1;
    const row = {
      id: id++, file: g.file, s: c.s, e, me: me.char, them: victim.char, stage: g.stage,
      opponent: `"${String(victim.name || victim.tag || "").replace(/"/g, `""`)}"`, label,
      dmg: dmg.toFixed(1), hits, distinct: new Set(c.moves.map((m) => m[0])).size,
      sp: c.sp.toFixed(1), ep: ep.toFixed(1), kill: c.kill ? 1 : 0,
      zeroToDeath: c.kill && c.sp < 1 ? 1 : 0, ragequit, gameWinner,
      seconds: seconds.toFixed(2), hitsPerSec: (hits / seconds).toFixed(2),
      maxHitShare: dmg > 0 ? (Math.max(...c.moves.map((m) => m[2])) / dmg).toFixed(2) : 1,
      neutralWin: c.open === "neutral-win" ? 1 : 0,
      lastMove: hits ? c.moves[hits - 1][0] : -1, singles,
      ...moveFeatures(c.moves),
    };
    out.push(cols.map((k) => row[k]).join(","));
  }
}
fs.writeFileSync("data/features.csv", out.join("\n") + "\n");
console.log("rows", out.length - 1, "labelled", out.filter((l) => l.split(",")[8] === "1").length);
