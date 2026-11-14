// Unpack a ratings package a friend sent (made with menu option 4 of the app):
// the ratings file goes to shared/<code>.json (commit it to ship it in the next release), and
// the replays go to received/<code>/ (git-ignored: they name the friend's opponents).
//
//   node receive.js path\to\ratings-ABCD-123.zip
const fs = require("fs");
const path = require("path");
const { readZip } = require("./zip");

function receive(zipFile) {
  const entries = readZip(zipFile);
  const ratings = entries.find((e) => /^ratings-[^/]+\.json$/.test(e.name));
  if (!ratings) throw new Error(`${zipFile} has no ratings-<code>.json inside`);
  const data = JSON.parse(ratings.read().toString("utf8"));
  if (!Array.isArray(data.rows) || !data.rater) throw new Error(`${ratings.name} doesn't look like a ratings file`);
  const slug = ratings.name.replace(/^ratings-/, "").replace(/\.json$/, "");
  if (!/^[A-Za-z0-9-]+$/.test(slug)) throw new Error(`unexpected file name ${ratings.name}`);

  fs.mkdirSync("shared", { recursive: true });
  const sharedFile = path.join("shared", `${slug}.json`);
  const previous = fs.existsSync(sharedFile) ? JSON.parse(fs.readFileSync(sharedFile, "utf8")).rows.length : 0;
  fs.writeFileSync(sharedFile, JSON.stringify(data) + "\n");

  const dir = path.join("received", slug);
  fs.mkdirSync(dir, { recursive: true });
  let games = 0;
  for (const e of entries) {
    const m = e.name.match(/^replays\/([^/\\]+\.slp)$/);
    if (!m) continue; // ignore anything else, including path tricks like ../
    const dest = path.join(dir, m[1]);
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, e.read());
    games++;
  }
  console.log(`${data.rater}: ${data.rows.length} rated punishes (was ${previous}) -> ${sharedFile}`);
  console.log(`${games} replays -> ${dir}`);
  console.log(`To ship their ratings in the next release: git add ${sharedFile.replace(/\\/g, "/")} && git commit -m "feat: add ${data.rater}'s ratings"`);
}

module.exports = { receive };
if (require.main === module) {
  if (!process.argv[2]) {
    console.log("Usage: node receive.js ratings-ABCD-123.zip");
    process.exit(1);
  }
  try { receive(process.argv[2]); } catch (e) { console.error(e.message); process.exit(1); }
}
