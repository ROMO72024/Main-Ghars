const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");
const assert = require("assert");

const values = new Map();
const properties = {
  getProperty(key) { return values.has(key) ? values.get(key) : null; },
  setProperty(key, value) { values.set(key, String(value)); return this; },
  deleteProperty(key) { values.delete(key); return this; },
  getProperties() { return Object.fromEntries(values); },
  setProperties(entries) { Object.entries(entries).forEach(([key, value]) => values.set(key, String(value))); return this; }
};

function webSafeBase64(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}
function decodeWebSafe(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => properties },
  Utilities: {
    Charset: { UTF_8: "utf8" },
    DigestAlgorithm: { SHA_256: "sha256" },
    getUuid: () => crypto.randomUUID(),
    base64EncodeWebSafe: (value) => webSafeBase64(typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value)),
    base64DecodeWebSafe: (value) => [...decodeWebSafe(value)],
    computeHmacSha256Signature: (value, key) => [...crypto.createHmac("sha256", key).update(String(value)).digest()],
    computeDigest: (_algorithm, value) => [...crypto.createHash("sha256").update(String(value)).digest()],
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") })
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("server/Attendance-Code.gs", "utf8"), sandbox);

assert.equal(vm.runInContext("portalAdminId_()", sandbox), "4646");
const issued = vm.runInContext("issuePortalAdminToken_('4646')", sandbox);
assert.ok(issued.token.includes("."));
const payload = vm.runInContext(`requirePortalAdmin_({authToken:${JSON.stringify(issued.token)}})`, sandbox);
assert.equal(payload.teacherId, "4646");
assert.equal(payload.role, "admin");

properties.setProperty("GHARS_PORTAL_ADMIN_ID", "NEW4646");
assert.throws(
  () => vm.runInContext(`requirePortalAdmin_({authToken:${JSON.stringify(issued.token)}})`, sandbox),
  /تغيير كود المدير/
);

assert.equal(vm.runInContext("validPortalId_('AS1992')", sandbox), "AS1992");
assert.throws(() => vm.runInContext("validPortalId_('كود غير صالح')", sandbox), /الحروف الإنجليزية/);

console.log("All server auth tests passed.");
