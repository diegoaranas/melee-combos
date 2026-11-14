// Index Slippi replays: settings, players and conversions (punishes) per game.
// Usage: node index.js <worker> <nworkers> <out.jsonl>
const fs = require("fs");
const path = require("path");
const { SlippiGame } = require("@slippi/slippi-js");

const ROOT = require("./config").load().replays;
const [worker, nworkers, out] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".slp") ? [p] : [];
  });
}

const files = walk(ROOT).sort().filter((_, i) => i % nworkers === worker);
// Skip games already in any index file, so a different worker count doesn't index them twice.
const done = new Set();
const dataDir = path.dirname(out);
for (const f of fs.readdirSync(dataDir).filter((f) => /^index_\d+\.jsonl$/.test(f))) {
  for (const line of fs.readFileSync(path.join(dataDir, f), "utf8").split("\n")) {
    if (line) done.add(JSON.parse(line).file);
  }
}
const fd = fs.openSync(out, "a");

for (const file of files) {
  if (done.has(file)) continue;
  let rec = { file };
  try {
    const game = new SlippiGame(file);
    const settings = game.getSettings();
    const meta = game.getMetadata() || {};
    const latest = game.getLatestFrame();
    const stats = game.getStats();
    const end = game.getGameEnd();
    rec = {
      file,
      startAt: meta.startAt,
      lastFrame: latest ? latest.frame : null,
      stage: settings.stageId,
      timerStart: settings.startingTimerSeconds,
      isTeams: settings.isTeams,
      gameMode: settings.gameMode,
      matchId: settings.matchInfo ? settings.matchInfo.matchId : null,
      gameEnd: end ? { method: end.gameEndMethod, lras: end.lrasInitiatorIndex, placements: end.placements } : null,
      players: settings.players.map((p) => ({
        idx: p.playerIndex,
        char: p.characterId,
        color: p.characterColor,
        type: p.type,
        code: p.connectCode,
        name: p.displayName,
        tag: p.nametag,
      })),
      conversions: stats.conversions.map((c) => ({
        p: c.playerIndex,
        opp: c.lastHitBy,
        s: c.startFrame,
        e: c.endFrame,
        sp: c.startPercent,
        ep: c.endPercent,
        kill: c.didKill,
        open: c.openingType,
        moves: c.moves.map((m) => [m.moveId, m.frame, Math.round(m.damage * 10) / 10]),
      })),
    };
  } catch (err) {
    rec.error = String(err);
  }
  fs.writeSync(fd, JSON.stringify(rec) + "\n");
}
fs.closeSync(fd);
