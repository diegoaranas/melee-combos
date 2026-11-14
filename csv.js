// Minimal CSV reader: handles quoted cells with commas and doubled quotes. Returns objects.
const fs = require("fs");

function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head = [], ...body] = rows;
  return body.map((c) => Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""])));
}

const readCsv = (file) => parseCsv(fs.readFileSync(file, "utf8"));

module.exports = { parseCsv, readCsv };
