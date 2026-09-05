const fs = require("fs");
const assert = require("assert");
const { JSDOM, VirtualConsole } = require("jsdom");

const html = fs.readFileSync("www/index.html", "utf8");
const configSource = fs.readFileSync("www/js/config.js", "utf8");
const appSource = fs.readFileSync("www/js/app.js", "utf8");

function wait(ms = 15) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function createPortal(responder) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(html, {
    url: "https://localhost/index.html",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole
  });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
  Object.defineProperty(dom.window.navigator, "onLine", { configurable: true, value: true });
  dom.window.scrollTo = function () {};
  dom.window.open = function () { return { opener: null }; };
  dom.window.fetch = async function (_url, options) {
    const body = JSON.parse(options.body);
    const data = await responder(body);
    return { ok: true, json: async () => data };
  };
  dom.window.eval(configSource);
  dom.window.eval(appSource);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await wait();
  return { dom, errors };
}

async function submitLogin(window, code) {
  window.document.getElementById("accessCode").value = code;
  window.document.getElementById("loginForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
}

(async function () {
  let teacherApiCalls = 0;
  const teacher = await createPortal(async (body) => {
    teacherApiCalls += 1;
    assert.equal(body.action, "portal_login");
    return {
      ok: true, role: "teacher", teacherId: "A1989", teacherName: "آلاء عياش",
      className: "الرابع (1)", classSheetId: "10", students: ["ليان", "محمد"],
      attendance: { ليان: "غائب", محمد: "حاضر" }, date: "2026-09-05", submitted: true
    };
  });
  await submitLogin(teacher.dom.window, "A1989");
  assert.equal(teacher.dom.window.document.getElementById("loginView").hidden, true);
  assert.equal(teacher.dom.window.document.getElementById("portalView").hidden, false);
  assert.equal(teacher.dom.window.document.getElementById("adminModule").hidden, true);
  assert.equal(teacher.dom.window.document.getElementById("headerName").textContent, "آلاء عياش");
  const attendanceState = JSON.parse(teacher.dom.window.localStorage.getItem("ghars.state.v4"));
  assert.equal(attendanceState.teacherId, "A1989");
  assert.equal(attendanceState.marks["ليان"], "غائب");
  teacher.dom.window.document.getElementById("lockButton").click();
  assert.equal(teacher.dom.window.document.getElementById("loginView").hidden, false);
  assert.equal(teacher.dom.window.localStorage.getItem("ghars.state.v4"), null);

  Object.defineProperty(teacher.dom.window.navigator, "onLine", { configurable: true, value: false });
  await submitLogin(teacher.dom.window, "A1989");
  assert.equal(teacher.dom.window.document.getElementById("loginView").hidden, true);
  assert.equal(teacher.dom.window.document.getElementById("portalView").hidden, false);
  assert.equal(teacherApiCalls, 1, "Offline login must use the cached profile without calling the server");
  const offlineAttendanceState = JSON.parse(teacher.dom.window.localStorage.getItem("ghars.state.v4"));
  assert.equal(offlineAttendanceState.teacherId, "A1989");
  assert.equal(offlineAttendanceState.marks["ليان"], "غائب");
  assert.deepEqual(teacher.errors, []);
  teacher.dom.window.close();

  const admin = await createPortal(async (body) => {
    if (body.action === "portal_login") {
      return {
        ok: true, role: "admin", teacherId: "4646", teacherName: "رامي الراجحي",
        className: "الإدارة", classSheetId: "99", students: [], attendance: {},
        authToken: "signed.token", authExpiresAt: Date.now() + 100000, date: "2026-09-05"
      };
    }
    if (body.action === "portal_admin_list") {
      assert.equal(body.authToken, "signed.token");
      return {
        ok: true,
        teachers: [
          { teacherId: "4646", teacherName: "رامي الراجحي", className: "الإدارة", role: "admin" },
          { teacherId: "A1989", teacherName: "آلاء عياش", className: "الرابع (1)", role: "teacher" }
        ]
      };
    }
    throw new Error(`Unexpected action ${body.action}`);
  });
  await submitLogin(admin.dom.window, "4646");
  assert.equal(admin.dom.window.document.getElementById("adminModule").hidden, false);
  admin.dom.window.document.getElementById("adminModule").click();
  await wait(30);
  assert.equal(admin.dom.window.document.getElementById("adminSection").hidden, false);
  assert.equal(admin.dom.window.document.querySelectorAll(".teacher-row").length, 2);
  assert.equal(admin.dom.window.document.getElementById("teacherCount").textContent, "2");
  assert.deepEqual(admin.errors, []);
  admin.dom.window.close();

  console.log("All portal DOM tests passed.");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
