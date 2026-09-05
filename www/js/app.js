(function () {
  "use strict";

  var CFG = window.GHARS_CONFIG;
  var CACHE_KEY = "ghars.portal.profiles.v1";
  var ACTIVE_KEY = "ghars.portal.active.v1";
  var ATT_STATE_KEY = "ghars.state.v4";
  var ATT_DIR_KEY = "ghars.dir.v4";
  var ATT_QUEUE_KEY = "ghars.queue.v4";
  var state = { profile: null, teachers: [], pendingDelete: null, nativeReady: false };

  function $(id) { return document.getElementById(id); }
  function keyOf(value) { return String(value || "").trim().toLowerCase(); }
  function initials(value) {
    var parts = String(value || "غرس").trim().split(/\s+/).filter(Boolean);
    return (parts[0] ? parts[0].charAt(0) : "غ") + (parts[1] ? parts[1].charAt(0) : "");
  }
  function readJson(key, fallback, storage) {
    try {
      var raw = (storage || localStorage).getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeJson(key, value, storage) {
    try { (storage || localStorage).setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function removeKey(key, storage) {
    try { (storage || localStorage).removeItem(key); } catch (_) {}
  }
  function todayIso() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Gaza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var values = {};
      parts.forEach(function (part) { values[part.type] = part.value; });
      return values.year + "-" + values.month + "-" + values.day;
    } catch (_) {
      var now = new Date();
      return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    }
  }
  function uid() {
    if (window.crypto && crypto.getRandomValues) {
      var bytes = new Uint32Array(2); crypto.getRandomValues(bytes);
      return Date.now().toString(36) + "-" + bytes[0].toString(36) + bytes[1].toString(36);
    }
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 11);
  }

  function setMessage(element, text, kind) {
    element.textContent = text || "";
    element.classList.toggle("good", kind === "good");
    element.hidden = !text;
  }
  function toast(message, kind) {
    var item = document.createElement("div");
    item.className = "toast" + (kind ? " " + kind : "");
    item.textContent = message;
    $("toasts").appendChild(item);
    setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 3500);
  }
  function setBusy(button, busy, busyLabel) {
    if (!button.dataset.label) button.dataset.label = button.querySelector("span") ? button.querySelector("span").textContent : button.textContent;
    button.disabled = !!busy;
    var label = button.querySelector("span");
    if (label) label.textContent = busy ? busyLabel : button.dataset.label;
    else button.textContent = busy ? busyLabel : button.dataset.label;
  }

  function callApi(action, payload, timeoutMs) {
    var controller = "AbortController" in window ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 20000) : null;
    var body = Object.assign({ action: action }, payload || {});
    return fetch(CFG.attendanceApi, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (timer) clearTimeout(timer);
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    }).catch(function (error) {
      if (timer) clearTimeout(timer);
      error.network = true;
      throw error;
    });
  }

  function cacheProfile(profile, loginData) {
    var profiles = readJson(CACHE_KEY, {});
    profiles[keyOf(profile.teacherId)] = { profile: profile, loginData: loginData || null, savedAt: Date.now() };
    writeJson(CACHE_KEY, profiles);
  }
  function removeCachedProfile(teacherId) {
    var profiles = readJson(CACHE_KEY, {});
    delete profiles[keyOf(teacherId)];
    writeJson(CACHE_KEY, profiles);
  }
  function cachedFor(code) { return readJson(CACHE_KEY, {})[keyOf(code)] || null; }

  function attendanceDefaults(students, marks) {
    var out = {};
    (students || []).forEach(function (name) { out[name] = marks && marks[name] ? marks[name] : "حاضر"; });
    return out;
  }
  function hasPendingAttendance(teacherId) {
    var queue = readJson(ATT_QUEUE_KEY, []);
    var wanted = keyOf(teacherId);
    return Array.isArray(queue) && queue.some(function (operation) { return keyOf(operation && operation.teacherId) === wanted; });
  }
  function seedAttendance(loginData) {
    if (!loginData || !loginData.teacherId) return;
    var teacherKey = keyOf(loginData.teacherId);
    var directory = readJson(ATT_DIR_KEY, {});
    var previous = directory[teacherKey] || null;
    var keepLocalWork = previous && (previous.dirty || previous.pendingAttendanceId || hasPendingAttendance(loginData.teacherId));
    var entry;

    if (keepLocalWork) {
      entry = Object.assign({}, previous, {
        teacherId: String(loginData.teacherId),
        teacherName: String(loginData.teacherName || previous.teacherName || ""),
        className: String(loginData.className || previous.className || ""),
        classSheetId: String(loginData.classSheetId || previous.classSheetId || "")
      });
    } else {
      var students = Array.isArray(loginData.students) ? loginData.students.slice() : [];
      entry = {
        teacherId: String(loginData.teacherId),
        teacherName: String(loginData.teacherName || ""),
        className: String(loginData.className || ""),
        students: students,
        marks: attendanceDefaults(students, loginData.attendance || {}),
        classSheetId: String(loginData.classSheetId || ""),
        date: String(loginData.date || todayIso()),
        submitted: !!loginData.submitted,
        dirty: false,
        pendingAttendanceId: "",
        syncedAttendanceId: loginData.submitted ? "server" : "",
        lastSyncedAt: Number(loginData.serverTime || Date.now())
      };
    }
    directory[teacherKey] = entry;
    writeJson(ATT_DIR_KEY, directory);
    writeJson(ATT_STATE_KEY, entry);
  }

  function profileFrom(result, typedCode, legacy) {
    return {
      teacherId: String(result.teacherId || typedCode || "").trim(),
      teacherName: String(result.teacherName || "مستخدم غرس").trim(),
      className: String(result.className || "").trim(),
      role: String(result.role || "teacher"),
      authToken: String(result.authToken || ""),
      authExpiresAt: Number(result.authExpiresAt || 0),
      moduleLinks: result.moduleLinks && typeof result.moduleLinks === "object" ? result.moduleLinks : {},
      serverVerifiedAt: Date.now(),
      legacy: !!legacy
    };
  }

  function onlineLogin(code) {
    return callApi("portal_login", { teacherId: code, date: todayIso(), deviceId: deviceId() }, 22000)
      .then(function (result) {
        if (result && result.ok) return { result: result, legacy: false };
        if (!result || result.code !== "UNKNOWN_ACTION") return { result: result || { ok: false, message: "تعذّر التحقق من الكود." }, legacy: false };
        return callApi("login", { teacherId: code, date: todayIso() }, 22000)
          .then(function (legacyResult) { return { result: legacyResult, legacy: true }; });
      });
  }
  function deviceId() {
    var key = "ghars.portal.device.v1";
    var current = "";
    try { current = localStorage.getItem(key) || ""; } catch (_) {}
    if (!current) {
      current = uid();
      try { localStorage.setItem(key, current); } catch (_) {}
    }
    return current;
  }

  function activate(profile, loginData, options) {
    options = options || {};
    state.profile = profile;
    if (loginData) seedAttendance(loginData);
    if (!options.skipCache) cacheProfile(profile, loginData);
    writeJson(ACTIVE_KEY, { teacherId: profile.teacherId, startedAt: Date.now() }, sessionStorage);

    $("loginView").hidden = true;
    $("portalView").hidden = false;
    $("welcomeName").textContent = firstName(profile.teacherName);
    $("welcomeSubtitle").textContent = profile.role === "admin"
      ? "لوحة التحكم وجميع أنظمة غرس بين يديك."
      : ((profile.className ? profile.className + " · " : "") + "كل ما تحتاجه لدوام اليوم في مكان واحد.");
    $("adminModule").hidden = profile.role !== "admin";
    $("adminNav").hidden = profile.role !== "admin";
    $("moduleCount").textContent = profile.role === "admin" ? "6 أنظمة" : "5 أنظمة";
    paintDate();
    paintNextClass();
    updateConnectivity();
    showView("home");
  }
  function firstName(name) {
    var clean = String(name || "").replace(/^(أ\.?|الأستاذة|المعلمة|الأستاذ)\s+/, "").trim();
    return clean.split(/\s+/)[0] || "بك";
  }
  function greeting() {
    var hour = new Date().getHours();
    if (hour < 12) return "صباح الخير";
    if (hour < 18) return "مساء الخير";
    return "أهلاً بك";
  }
  function paintDate() {
    var now = new Date();
    $("greetingWord").textContent = greeting();
    try { $("todayLabel").textContent = new Intl.DateTimeFormat("ar", { timeZone: "Asia/Gaza", weekday: "long", day: "numeric", month: "long" }).format(now); }
    catch (_) { $("todayLabel").textContent = "يوم جديد في غرس"; }
  }

  function nextLesson() {
    var classes = readJson("gharsClasses", []);
    if (!Array.isArray(classes) || !classes.length) return null;
    var now = new Date();
    var choices = [];
    classes.forEach(function (lesson) {
      var day = Number(lesson.day);
      var time = String(lesson.startTime || "").split(":");
      if (day < 0 || day > 6 || time.length < 2) return;
      var candidate = new Date(now);
      var delta = (day - now.getDay() + 7) % 7;
      candidate.setDate(now.getDate() + delta);
      candidate.setHours(Number(time[0]), Number(time[1]), 0, 0);
      if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
      choices.push({ lesson: lesson, date: candidate });
    });
    choices.sort(function (a, b) { return a.date - b.date; });
    return choices[0] || null;
  }
  function paintNextClass() {
    var upcoming = nextLesson();
    if (!upcoming) { $("nextEventText").textContent = "أضف جدولك ليظهر الموعد هنا"; return; }
    var now = new Date();
    var label = upcoming.date.toDateString() === now.toDateString() ? "اليوم" : new Intl.DateTimeFormat("ar", { weekday: "long" }).format(upcoming.date);
    var time = new Intl.DateTimeFormat("ar", { hour: "numeric", minute: "2-digit" }).format(upcoming.date);
    $("nextEventText").textContent = String(upcoming.lesson.subject || "حصة") + " · " + label + " " + time;
  }

  function performLogin(event) {
    event.preventDefault();
    var code = String($("accessCode").value || "").trim();
    var button = $("loginButton");
    var message = $("loginMessage");
    if (!code) { setMessage(message, "أدخل كود الدخول أولاً."); $("accessCode").focus(); return; }
    if (code.length < 3) { setMessage(message, "كود الدخول أقصر من اللازم."); return; }
    setMessage(message, "");
    setBusy(button, true, navigator.onLine ? "جارٍ التحقق…" : "دخول دون إنترنت…");

    if (!navigator.onLine) {
      var cached = cachedFor(code);
      if (!cached) {
        setMessage(message, "أول دخول لهذا الكود يحتاج اتصالاً بالإنترنت مرة واحدة.");
        setBusy(button, false, "");
        return;
      }
      activate(cached.profile, cached.loginData, { skipCache: true });
      toast("تم الدخول من البيانات المحفوظة على الجهاز", "good");
      setBusy(button, false, "");
      return;
    }

    onlineLogin(code).then(function (response) {
      var result = response.result;
      if (!result || !result.ok) {
        if (result && result.code === "NOT_FOUND") removeCachedProfile(code);
        setMessage(message, (result && result.message) || "الكود غير موجود أو غير صالح.");
        return;
      }
      var profile = profileFrom(result, code, response.legacy);
      activate(profile, result);
      if (response.legacy) toast("الدخول يعمل؛ فعّل ملف الخادم الجديد لتشغيل صلاحيات الإدارة.");
    }).catch(function () {
      var cached = cachedFor(code);
      if (cached) {
        activate(cached.profile, cached.loginData, { skipCache: true });
        toast("الاتصال ضعيف؛ تم الدخول من النسخة المحفوظة", "good");
      } else setMessage(message, "تعذّر الوصول إلى الخادم. تحقق من الإنترنت وحاول مجدداً.");
    }).then(function () { setBusy(button, false, ""); });
  }

  function lockPortal() {
    state.profile = null;
    state.teachers = [];
    removeKey(ACTIVE_KEY, sessionStorage);
    removeKey(ATT_STATE_KEY);
    $("portalView").hidden = true;
    $("loginView").hidden = false;
    $("accessCode").value = "";
    setMessage($("loginMessage"), "");
    setTimeout(function () { $("accessCode").focus(); }, 50);
  }

  function updateConnectivity() {
    var online = navigator.onLine;
    [$("loginConnection"), $("portalConnection")].forEach(function (item) {
      item.classList.toggle("offline", !online);
      item.querySelector("b").textContent = online ? "متصل" : "دون إنترنت";
    });
    $("syncTitle").textContent = online ? "الاتصال متاح والأنظمة جاهزة" : "وضع العمل دون إنترنت";
    $("syncText").textContent = online ? "ستتم مزامنة سجلات الحضور المحفوظة تلقائياً." : "الحضور والحصص مستمران، والمزامنة تعود تلقائياً لاحقاً.";
    $("adminConnection").textContent = online ? "متصل" : "غير متصل";
  }

  function showView(name) {
    if (name === "admin" && (!state.profile || state.profile.role !== "admin")) return;
    $("homeSection").hidden = name !== "home";
    $("adminSection").hidden = name !== "admin";
    document.querySelectorAll("[data-view-link]").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-view-link") === name);
    });
    window.scrollTo(0, 0);
    if (name === "admin") loadTeachers();
  }

  function openModule(name) {
    if (name === "admin") { showView("admin"); return; }
    var module = CFG.modules[name];
    if (!module) return;
    if (module.comingSoon) { toast("دفتر التحضير سيكون متاحاً قريباً."); return; }
    if (module.online && !navigator.onLine) { toast("هذا النظام يحتاج اتصالاً بالإنترنت.", "bad"); return; }
    if (module.local) {
      window.location.href = module.local;
      return;
    }
    var remoteUrl = state.profile && state.profile.moduleLinks ? state.profile.moduleLinks[name] : "";
    var targetUrl = String(remoteUrl || module.external || "").trim();
    if (!targetUrl) {
      toast("رابط هذا النظام غير مهيأ بعد.");
      return;
    }
    openExternal(targetUrl);
  }
  function openExternal(url) {
    if (window.cordova && cordova.InAppBrowser && typeof cordova.InAppBrowser.open === "function") {
      cordova.InAppBrowser.open(url, "_blank", "location=yes,toolbar=yes,footer=no,zoom=no,hardwareback=yes,hideurlbar=yes,hidenavigationbuttons=yes,closebuttoncaption=إغلاق,clearsessioncache=no");
    } else {
      var opened = window.open(url, "_blank");
      if (opened) {
        try { opened.opener = null; } catch (_) {}
      } else window.location.href = url;
    }
  }

  function requireAdminToken() {
    if (!state.profile || state.profile.role !== "admin") return false;
    if (!state.profile.authToken) {
      toast("ثبّت ملف Attendance-Code.gs الجديد ثم أعد تسجيل الدخول لتفعيل إدارة الأكواد.", "bad");
      return false;
    }
    return true;
  }
  function adminCall(action, payload) {
    if (!requireAdminToken()) return Promise.reject(new Error("ADMIN_NOT_READY"));
    return callApi(action, Object.assign({ authToken: state.profile.authToken }, payload || {}), 24000).then(function (result) {
      if (!result || !result.ok) {
        var error = new Error((result && result.message) || "تعذّر تنفيذ العملية.");
        error.code = result && result.code;
        throw error;
      }
      return result;
    });
  }
  function loadTeachers() {
    if (!state.profile || state.profile.role !== "admin") return;
    if (!navigator.onLine) {
      renderTeachers(readJson("ghars.portal.admin-list.v1", []));
      toast("تعرض القائمة آخر نسخة محفوظة؛ التعديل يحتاج إنترنت.");
      return;
    }
    if (!requireAdminToken()) {
      renderTeachers([]);
      return;
    }
    $("teacherList").replaceChildren(loadingElement("جارٍ تحميل أكواد الكادر…"));
    adminCall("portal_admin_list").then(function (result) {
      state.teachers = Array.isArray(result.teachers) ? result.teachers : [];
      writeJson("ghars.portal.admin-list.v1", state.teachers);
      renderTeachers(state.teachers);
    }).catch(function (error) {
      $("teacherList").replaceChildren(loadingElement(error.message || "تعذّر تحميل القائمة.", true));
    });
  }
  function loadingElement(text, empty) {
    var node = document.createElement("div");
    node.className = empty ? "empty-list" : "loading-list";
    node.textContent = text;
    return node;
  }
  function actionButton(icon, label, handler, danger) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", label);
    if (danger) button.className = "danger";
    var image = document.createElement("img"); image.src = "assets/icons/" + icon; image.alt = "";
    button.appendChild(image);
    button.addEventListener("click", handler);
    return button;
  }
  function renderTeachers(list) {
    $("teacherCount").textContent = String(list.length || 0);
    var root = $("teacherList"); root.replaceChildren();
    if (!list.length) { root.appendChild(loadingElement("لا توجد بيانات محفوظة لعرضها حالياً.", true)); return; }
    list.forEach(function (teacher) {
      var row = document.createElement("article");
      row.className = "teacher-row" + (teacher.role === "admin" ? " admin-row" : "");
      var avatar = document.createElement("span"); avatar.className = "teacher-avatar"; avatar.textContent = initials(teacher.teacherName);
      var main = document.createElement("span"); main.className = "teacher-main";
      var mainName = document.createElement("b"); mainName.textContent = teacher.teacherName || "بلا اسم";
      var code = document.createElement("small"); code.textContent = teacher.role === "admin" ? "مدير النظام · " + teacher.teacherId : "الكود: " + teacher.teacherId;
      main.append(mainName, code);
      var classInfo = document.createElement("span"); classInfo.className = "teacher-class";
      var className = document.createElement("b"); className.textContent = teacher.className || "لم يُحدد الصف";
      var classLabel = document.createElement("small"); classLabel.textContent = "الصف أو المهمة";
      classInfo.append(className, classLabel);
      var actions = document.createElement("span"); actions.className = "teacher-actions";
      actions.appendChild(actionButton("open.svg", "فتح حضور " + teacher.teacherName, function () { loginAsTeacher(teacher.teacherId); }));
      actions.appendChild(actionButton("edit.svg", "تعديل " + teacher.teacherName, function () { openTeacherModal(teacher); }));
      if (teacher.role !== "admin") actions.appendChild(actionButton("trash.svg", "حذف كود " + teacher.teacherName, function () { confirmDelete(teacher); }, true));
      row.append(avatar, main, classInfo, actions);
      root.appendChild(row);
    });
  }

  function openModal(id) { $(id).hidden = false; document.body.style.overflow = "hidden"; }
  function closeModal(id) { $(id).hidden = true; document.body.style.overflow = ""; }
  function openTeacherModal(teacher) {
    teacher = teacher || null;
    $("teacherModalTitle").textContent = teacher ? "تعديل بيانات الكود" : "إضافة كود جديد";
    $("originalTeacherId").value = teacher ? teacher.teacherId : "";
    $("teacherId").value = teacher ? teacher.teacherId : "";
    $("teacherName").value = teacher ? teacher.teacherName : "";
    $("teacherClass").value = teacher ? teacher.className : "";
    setMessage($("teacherFormMessage"), "");
    openModal("teacherModal");
    setTimeout(function () { $("teacherId").focus(); }, 80);
  }
  function saveTeacher(event) {
    event.preventDefault();
    var payload = {
      originalTeacherId: $("originalTeacherId").value.trim(),
      teacherId: $("teacherId").value.trim(),
      teacherName: $("teacherName").value.trim(),
      className: $("teacherClass").value.trim()
    };
    var message = $("teacherFormMessage");
    if (!payload.teacherId || !payload.teacherName || !payload.className) { setMessage(message, "املأ الكود والاسم والصف بالكامل."); return; }
    setBusy($("saveTeacherButton"), true, "جارٍ الحفظ…");
    adminCall("portal_admin_save_user", payload).then(function () {
      closeModal("teacherModal"); toast("تم حفظ بيانات الكود", "good"); loadTeachers();
    }).catch(function (error) { setMessage(message, error.message || "تعذّر حفظ البيانات."); })
      .then(function () { setBusy($("saveTeacherButton"), false, ""); });
  }
  function confirmDelete(teacher) {
    state.pendingDelete = teacher;
    $("confirmText").textContent = "سيُلغى دخول " + teacher.teacherName + "، مع إبقاء سجلات الصف السابقة محفوظة.";
    $("confirmLayer").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function cancelDelete() { state.pendingDelete = null; $("confirmLayer").hidden = true; document.body.style.overflow = ""; }
  function acceptDelete() {
    if (!state.pendingDelete) return;
    var teacher = state.pendingDelete;
    setBusy($("acceptConfirm"), true, "جارٍ الحذف…");
    adminCall("portal_admin_delete_user", { teacherId: teacher.teacherId }).then(function () {
      cancelDelete(); toast("تم إلغاء الكود مع الحفاظ على بيانات الصف", "good"); loadTeachers();
    }).catch(function (error) { toast(error.message || "تعذّر حذف الكود.", "bad"); })
      .then(function () { setBusy($("acceptConfirm"), false, ""); });
  }
  function loginAsTeacher(teacherId) {
    if (!navigator.onLine) { toast("فتح صف آخر يحتاج اتصالاً بالإنترنت.", "bad"); return; }
    adminCall("portal_admin_login_as", { teacherId: teacherId, date: todayIso() }).then(function (result) {
      seedAttendance(result);
      window.location.href = CFG.modules.attendance.local;
    }).catch(function (error) { toast(error.message || "تعذّر فتح الصف.", "bad"); });
  }
  function changeAdminCode(event) {
    event.preventDefault();
    var code = $("newAdminCode").value.trim();
    var confirmation = $("confirmAdminCode").value.trim();
    var message = $("adminCodeMessage");
    if (code.length < 4) { setMessage(message, "استخدم كوداً من 4 محارف على الأقل."); return; }
    if (code !== confirmation) { setMessage(message, "الكودان غير متطابقين."); return; }
    setBusy($("saveAdminCodeButton"), true, "جارٍ التغيير…");
    var oldId = state.profile.teacherId;
    adminCall("portal_admin_change_code", { newAdminId: code }).then(function (result) {
      removeCachedProfile(oldId);
      state.profile.teacherId = String(result.teacherId || code);
      state.profile.authToken = String(result.authToken || "");
      state.profile.authExpiresAt = Number(result.authExpiresAt || 0);
      state.profile.moduleLinks = result.moduleLinks && typeof result.moduleLinks === "object" ? result.moduleLinks : state.profile.moduleLinks;
      state.profile.legacy = false;
      cacheProfile(state.profile, result);
      writeJson(ACTIVE_KEY, { teacherId: state.profile.teacherId, startedAt: Date.now() }, sessionStorage);
      seedAttendance(result);
      closeModal("adminCodeModal");
      $("newAdminCode").value = ""; $("confirmAdminCode").value = "";
      toast("تم تغيير كود المدير وإلغاء الكود السابق", "good");
      loadTeachers();
    }).catch(function (error) { setMessage(message, error.message || "تعذّر تغيير الكود."); })
      .then(function () { setBusy($("saveAdminCodeButton"), false, ""); });
  }

  function bindEvents() {
    $("loginForm").addEventListener("submit", performLogin);
    $("toggleCode").addEventListener("click", function () {
      var input = $("accessCode");
      var reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      this.setAttribute("aria-label", reveal ? "إخفاء الكود" : "إظهار الكود");
    });
    $("lockButton").addEventListener("click", lockPortal);
    $("refreshStatus").addEventListener("click", function () { updateConnectivity(); paintNextClass(); toast(navigator.onLine ? "الاتصال متاح" : "التطبيق في وضع عدم الاتصال"); });
    document.querySelectorAll("[data-module]").forEach(function (button) { button.addEventListener("click", function () { openModule(this.getAttribute("data-module")); }); });
    document.querySelectorAll("[data-view-link]").forEach(function (button) { button.addEventListener("click", function (event) { event.preventDefault(); showView(this.getAttribute("data-view-link")); }); });
    document.querySelectorAll("[data-close-modal]").forEach(function (node) { node.addEventListener("click", function () { closeModal(this.getAttribute("data-close-modal")); }); });
    $("addTeacherButton").addEventListener("click", function () { if (navigator.onLine && requireAdminToken()) openTeacherModal(); else if (!navigator.onLine) toast("إضافة كود تحتاج اتصالاً بالإنترنت.", "bad"); });
    $("reloadTeachers").addEventListener("click", loadTeachers);
    $("teacherForm").addEventListener("submit", saveTeacher);
    $("changeAdminCode").addEventListener("click", function () { if (navigator.onLine && requireAdminToken()) { setMessage($("adminCodeMessage"), ""); openModal("adminCodeModal"); } else if (!navigator.onLine) toast("تغيير الكود يحتاج اتصالاً بالإنترنت.", "bad"); });
    $("adminCodeForm").addEventListener("submit", changeAdminCode);
    $("cancelConfirm").addEventListener("click", cancelDelete);
    $("acceptConfirm").addEventListener("click", acceptDelete);
    window.addEventListener("online", function () { updateConnectivity(); toast("عاد الاتصال بالإنترنت", "good"); });
    window.addEventListener("offline", function () { updateConnectivity(); toast("تم تفعيل العمل دون إنترنت"); });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      ["teacherModal", "adminCodeModal"].forEach(function (id) { if (!$(id).hidden) closeModal(id); });
      if (!$("confirmLayer").hidden) cancelDelete();
    });
  }

  function restoreActiveSession() {
    var active = readJson(ACTIVE_KEY, null, sessionStorage);
    if (!active || !active.teacherId || Date.now() - Number(active.startedAt || 0) > 12 * 60 * 60 * 1000) return false;
    var cached = cachedFor(active.teacherId);
    if (!cached) return false;
    activate(cached.profile, cached.loginData, { skipCache: true });
    return true;
  }
  function boot() {
    bindEvents();
    updateConnectivity();
    restoreActiveSession();
    if (!$("loginView").hidden) setTimeout(function () { $("accessCode").focus(); }, 80);
  }

  document.addEventListener("deviceready", function () { state.nativeReady = true; }, false);
  document.addEventListener("DOMContentLoaded", boot);
}());
