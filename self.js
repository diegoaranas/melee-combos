// Running as a compiled exe (bun build --compile) or as plain `node app.js`.
// Subprocesses (index workers, review, render) are started by running this same program again
// with a subcommand, so they work in both modes.
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const COMPILED = !/^(node|bun)(\.exe)?$/i.test(path.basename(process.execPath));
const APP = path.join(__dirname, "app.js");

// [command, args] that run `app <sub> ...args`.
function selfCommand(sub, args = []) {
  return COMPILED ? [process.execPath, [sub, ...args]] : [process.execPath, [APP, sub, ...args]];
}

function runSelf(sub, args = [], opts = {}) {
  const [cmd, a] = selfCommand(sub, args);
  const r = spawnSync(cmd, a, { stdio: "inherit", ...opts });
  if (r.status) throw new Error(`${sub} exited with code ${r.status}`);
}

function spawnSelf(sub, args = [], opts = {}) {
  const [cmd, a] = selfCommand(sub, args);
  return spawn(cmd, a, opts);
}

module.exports = { COMPILED, runSelf, spawnSelf };
