const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const shellPath = path.join(root, "www", "index.html");
const shell = fs.readFileSync(shellPath, "utf8");
const app = fs.readFileSync(path.join(root, "www", "js", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "www", "css", "app.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server", "Attendance-Code.gs"), "utf8");

const ids = [...shell.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "The portal must not contain duplicate element ids");

const idSet = new Set(ids);
const jsIdRefs = [...app.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
const missingIds = [...new Set(jsIdRefs)].filter((id) => !idSet.has(id));
assert.deepEqual(missingIds, [], `Missing DOM ids used by app.js: ${missingIds.join(", ")}`);

const assets = [...shell.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1].split("?")[0])
  .filter((value) => value && !value.startsWith("#") && !/^https?:/.test(value) && value !== "cordova.js");
const missingAssets = assets.filter((value) => !fs.existsSync(path.join(root, "www", value)));
assert.deepEqual(missingAssets, [], `Missing shell assets: ${missingAssets.join(", ")}`);

const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const opens = (cssWithoutComments.match(/{/g) || []).length;
const closes = (cssWithoutComments.match(/}/g) || []).length;
assert.equal(opens, closes, "CSS braces must be balanced");

[
  "portal_login",
  "portal_admin_list",
  "portal_admin_save_user",
  "portal_admin_delete_user",
  "portal_admin_change_code",
  "portal_admin_login_as"
].forEach((action) => assert.ok(server.includes(`\"${action}\"`), `Missing server action: ${action}`));

[
  "www/modules/attendance/index.html",
  "www/modules/lessons/index.html",
  "play-store/privacy-policy-ar.html"
].forEach((relative) => assert.ok(fs.existsSync(path.join(root, relative)), `Missing project file: ${relative}`));

const attendanceHtml = fs.readFileSync(path.join(root, "www/modules/attendance/index.html"), "utf8");
const lessonsHtml = fs.readFileSync(path.join(root, "www/modules/lessons/index.html"), "utf8");
assert.ok(attendanceHtml.includes("../../index.html"), "Attendance must link back to portal");
assert.ok(lessonsHtml.includes("../../index.html"), "Lessons must link back to portal");
assert.ok(lessonsHtml.includes("../../cordova.js"), "Lessons must load the root Cordova bridge");

console.log("All structure tests passed.");
