const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

const configSource = fs.readFileSync("www/js/config.js", "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(configSource, sandbox);

const cfg = sandbox.window.GHARS_CONFIG;
assert.ok(cfg, "GHARS_CONFIG must exist");
assert.match(cfg.attendanceApi, /^https:\/\/script\.google\.com\/macros\/s\//);
assert.equal(cfg.modules.attendance.online, false);
assert.equal(cfg.modules.lessons.online, false);
assert.equal(cfg.modules.games.online, true);
assert.equal(cfg.modules.plans.online, true);
assert.match(cfg.modules.plans.external, /^https:\/\/script\.google\.com\/macros\/s\//);
assert.equal(cfg.modules.tasks.online, false);
assert.equal(cfg.modules.tasks.comingSoon, true);
assert.ok(cfg.modules.attendance.local.includes("modules/attendance"));
assert.ok(cfg.modules.lessons.local.includes("modules/lessons"));

const shell = fs.readFileSync("www/index.html", "utf8");
[
  "الحضور والغياب",
  "الحصص والتنبيهات",
  "الألعاب التعليمية",
  "الخطط والتقارير",
  "دفتر التحضير",
  "إدارة غرس"
].forEach((label) => assert.ok(shell.includes(label), `Missing module label: ${label}`));
assert.ok(shell.includes('placeholder="مثال: A0000"'), "Login example must use A0000");
assert.ok(shell.includes("قريباً..."), "Preparation notebook must be marked as coming soon");
assert.ok(shell.includes('id="lockButton"'), "A direct logout button must exist in the header");

console.log("All portal tests passed.");
