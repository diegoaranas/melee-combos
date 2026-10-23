// Per-frame features for the user's non-trivial punishes (>= 20% damage, a kill, or still open
// at game end). Usage: node framefeat.js <worker> <nworkers> <out.jsonl>
const fs = require("fs");
const { SlippiGame, State, isInControl, isDead } = require("@slippi/slippi-js");

const USER_CODE = "1SHINE#0";
const [worker, nworkers, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];

// Main platform half-width per stage id; anything beyond it (or below it) is off-stage.
const EDGE = { 2: 63.35, 3: 87.75, 8: 56.0, 28: 77.27, 31: 68.4, 32: 85.57 };
const LANDING_FALL_SPECIAL = 43; // wavedash / waveland landing
const AIR_DODGE = 236;
const JUMPS = [25, 26, 27, 28];
const CLIFF_CATCH = 252;

const games = fs.readdirSync("data").filter((f) => /^index_\d+\.jsonl$/.test(f))
  .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).map(JSON.parse))
  .filter((g) => g.conversions && g.players.some((p) => p.code === USER_CODE))
  .sort((a, b) => (a.file < b.file ? -1 : 1))
  .filter((_, i) => i % nworkers === worker);

const done = new Set();
if (fs.existsSync(out)) for (const l of fs.readFileSync(out, "utf8").split("\n")) if (l) done.add(JSON.parse(l).file);
const fd = fs.openSync(out, "a");

for (const g of games) {
  if (done.has(g.file)) continue;
  const me = g.players.find((p) => p.code === USER_CODE);
  const punishes = g.conversions.filter(
    (c) => c.opp === me.idx && (c.e == null || c.kill || (c.ep ?? 0) - c.sp >= 20)
  );
  const rec = { file: g.file, punishes: [] };
  try {
    const frames = punishes.length ? new SlippiGame(g.file).getFrames() : {};
    const edge = EDGE[g.stage] ?? 70;
    for (const c of punishes) {
      const end = c.e ?? g.lastFrame;
      let n = 0, offstage = 0, victimFree = 0, myAir = 0, lcancels = 0, wavelands = 0, airdodges = 0, jumps = 0, ledge = 0;
      let vMinX = Infinity, vMaxX = -Infinity, vMaxY = -Infinity, myTravel = 0, prevX = null;
      let prevMyState = null;
      let killX = null, killY = null;
      for (let f = c.s; f <= end; f++) {
        const fr = frames[f];
        if (!fr) continue;
        const mine = fr.players[me.idx]?.post;
        const vic = fr.players[c.p]?.post;
        if (!mine || !vic) continue;
        n++;
        const vx = vic.positionX, vy = vic.positionY;
        if (!isDead(vic.actionStateId)) {
          vMinX = Math.min(vMinX, vx); vMaxX = Math.max(vMaxX, vx); vMaxY = Math.max(vMaxY, vy);
          if (Math.abs(vx) > edge || vy < -5) offstage++;
          killX = vx; killY = vy;
        }
        if (isInControl(vic.actionStateId)) victimFree++;
        if (mine.isAirborne) myAir++;
        if (mine.lCancelStatus === 1) lcancels++;
        if (prevX != null) myTravel += Math.abs(mine.positionX - prevX);
        prevX = mine.positionX;
        const st = mine.actionStateId;
        if (st !== prevMyState) {
          if (st === LANDING_FALL_SPECIAL) wavelands++;
          if (st === AIR_DODGE) airdodges++;
          if (JUMPS.includes(st)) jumps++;
          if (st === CLIFF_CATCH) ledge++;
        }
        prevMyState = st;
      }
      if (!n) continue;
      rec.punishes.push({
        s: c.s,
        offstageFrac: +(offstage / n).toFixed(3),
        killOffstage: c.kill && killX != null && (Math.abs(killX) > edge || killY < -5) ? 1 : 0,
        victimFreeFrac: +(victimFree / n).toFixed(3),
        myAirFrac: +(myAir / n).toFixed(3),
        lcancels, wavelands, airdodges, jumps, ledge,
        victimXSpan: +(vMaxX - vMinX).toFixed(1),
        victimMaxY: +vMaxY.toFixed(1),
        myTravel: +myTravel.toFixed(1),
      });
    }
  } catch (err) {
    rec.error = String(err);
  }
  fs.writeSync(fd, JSON.stringify(rec) + "\n");
}
fs.closeSync(fd);
