// Build the downloadable exe: dist/melee-combos_windows_amd64.exe.
// Everyone's rating files in shared/ are built in (starter.json), so a new user's ranking works
// before they rate anything.
//
//   node build.js [version]
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const version = process.argv[2] || "dev";
// The bun devDependency's binary when its install script ran, else bun on PATH (CI installs it
// with oven-sh/setup-bun).
const LOCAL_BUN = path.join(__dirname, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
const BUN = fs.existsSync(LOCAL_BUN) && fs.statSync(LOCAL_BUN).size > 1e6 ? LOCAL_BUN : "bun";
const starter = {};
for (const f of fs.readdirSync("shared").filter((f) => f.endsWith(".json"))) {
  starter[f] = JSON.parse(fs.readFileSync(path.join("shared", f), "utf8"));
}
fs.writeFileSync("starter.json", JSON.stringify(starter));
console.log(`built-in ratings: ${Object.keys(starter).join(", ")}`);

fs.mkdirSync("dist", { recursive: true });
const targets = [["bun-windows-x64", "melee-combos_windows_amd64.exe"]];
for (const [target, name] of targets) {
  const r = spawnSync(BUN, ["build", "--compile", `--target=${target}`, "--minify",
    `--define=process.env.APP_VERSION="${version}"`, "app.js", "--outfile", path.join("dist", name)],
    { stdio: "inherit" });
  if (r.status) process.exit(r.status);
  // Cross-compiling for Windows on Linux leaves the file unreadable, which breaks the release
  // upload.
  fs.chmodSync(path.join("dist", name), 0o755);
}
