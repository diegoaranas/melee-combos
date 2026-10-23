const r = require(process.argv[2] || "./data/matches.json");
for (const x of r)
  console.log(x.id, x.replay ? `OK ${x.hits} ${x.replay.split(/[\/]/).pop()} f${x.startFrame}-${x.endFrame} | ${x.players}` : `NONE cands=${x.candidates}`);
