// Find games with a punish taking someone from ~lo% to ~hi% while the other player sits at `other`%.
const fs = require("fs");
const [lo, hi] = [Number(process.argv[2]), Number(process.argv[3])];
const games = fs.readdirSync("data").filter((f) => /^index_\d+\.jsonl$/.test(f))
  .flatMap((f) => fs.readFileSync(`data/${f}`, "utf8").split("\n").filter(Boolean).map(JSON.parse));
for (const g of games) {
  if (!g.conversions || g.players.length !== 2) continue;
  for (const c of g.conversions) {
    if (c.sp <= lo + 1 && c.ep >= hi - 1)
      console.log(g.file, c.s, c.e, Math.round(c.sp), Math.round(c.ep), g.players.map((p) => p.name || p.tag).join(" vs "));
  }
}
