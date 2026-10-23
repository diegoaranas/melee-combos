// Debug helper: print game end info and the last conversions of a replay.
const { SlippiGame } = require("@slippi/slippi-js");
const g = new SlippiGame(process.argv[2]);
const st = g.getStats();
console.log("lastFrame", g.getLatestFrame().frame, "end", JSON.stringify(g.getGameEnd()));
console.log(
  "conversions",
  st.conversions.length,
  JSON.stringify(
    st.conversions.slice(-3).map((c) => ({ p: c.playerIndex, by: c.lastHitBy, s: c.startFrame, e: c.endFrame, sp: c.startPercent, ep: c.endPercent, k: c.didKill }))
  )
);
