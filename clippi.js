// Re-implementation of Project Clippi's "default" combo profile, applied to punishes
// (conversions) where the user is the attacker. Writes data/clippi_combos.json.
const fs = require("fs");

const USER_CODE = "1SHINE#0";
const PROFILE = {
  minComboPercent: 60,
  perCharMinComboPercents: { 15: 85 }, // Jigglypuff
  comboMustKill: true,
  minComboLength: 1,
  excludeCPUs: true,
  chainGrabbers: [9, 12, 13, 22],
  chainGrabThreshold: 0.8,
  largeHitThreshold: 0.8,
  wobbleThreshold: 8,
};
const PUMMEL = 52;
const THROWS = [53, 54, 55, 56];

const games = fs.readdirSync("data").filter((f) => /^index_\d+\.jsonl$/.test(f))
  .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).map(JSON.parse))
  .filter((g) => g.conversions);

function rejectReason(c, attacker, victim) {
  const P = PROFILE;
  const dmg = c.ep - c.sp;
  const min = P.perCharMinComboPercents[attacker.char] ?? P.minComboPercent;
  if (P.excludeCPUs && victim.type === 1) return "cpu";
  if (dmg < min) return "damage";
  if (P.comboMustKill && !c.kill) return "no-kill";
  if (c.moves.length < P.minComboLength) return "length";
  if (c.moves.some((m) => m[2] >= P.largeHitThreshold * dmg)) return "large-hit";
  if (c.moves.filter((m) => m[0] === PUMMEL).length >= P.wobbleThreshold) return "wobble";
  if (P.chainGrabbers.includes(attacker.char)) {
    const grabby = c.moves.filter((m) => m[0] === PUMMEL || THROWS.includes(m[0])).length;
    if (grabby / c.moves.length >= P.chainGrabThreshold) return "chain-grab";
  }
  return null;
}

const out = [];
for (const g of games) {
  const me = g.players.find((p) => p.code === USER_CODE);
  if (!me) continue;
  for (const c of g.conversions) {
    if (c.opp !== me.idx) continue;
    const victim = g.players.find((p) => p.idx === c.p);
    if (!victim) continue;
    out.push({
      file: g.file,
      startAt: g.startAt,
      stage: g.stage,
      me: me.char,
      them: victim.char,
      opponent: victim.name || victim.tag,
      s: c.s,
      e: c.e,
      dmg: Math.round(c.ep - c.sp),
      sp: Math.round(c.sp),
      kill: c.kill,
      hits: c.moves.length,
      open: c.open,
      reject: rejectReason(c, me, victim),
    });
  }
}
fs.writeFileSync("data/punishes_mine.json", JSON.stringify(out));
const kept = out.filter((x) => !x.reject);
fs.writeFileSync("data/clippi_combos.json", JSON.stringify(kept, null, 1));
const why = {};
for (const x of out) why[x.reject || "kept"] = (why[x.reject || "kept"] || 0) + 1;
console.log(`games with me: ${games.filter((g) => g.players.some((p) => p.code === USER_CODE)).length}/${games.length}`);
console.log("punishes by me:", out.length, why);
