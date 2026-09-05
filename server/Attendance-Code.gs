/*************************************************************************
 * مدرسة وروضة غرس الحديثة — نظام الحضور والغياب
 * Code.gs  |  الإصدار 5.1.2  |  خادم متوازٍ يدعم المزامنة المجمّعة والعمل دون إنترنت
 *
 * تم بناء هذا الإصدار بمبدأ (Idempotent Upsert) لمنع التكرار نهائياً
 * تحت ضغط إعادة الإرسال من التطبيق، وتسريع المزامنة لأقصى حد.
 *************************************************************************/

/* ====================== الإعدادات ====================== */
const CONFIG = {
  SPREADSHEET_ID:     "",
  MASTER_FOLDER_ID:   "1Kmc2ONIp8SP4TPhmWj67RFk84_3HejTI",
  LETTERHEAD_FILE_ID: "1f4ICYyWJQDeWe5Ou9lxA83uzlq6-kKRT",
  PDF_HOUR:           20,          
  TIMEZONE:           "Asia/Gaza"
};

const SH_TEACHERS = "Teachers";
const SH_STUDENTS = "Students";
const SYSTEM_SHEETS = ["Teachers", "Students", "ورقة الإعدادات", "Settings", "Config", "Log"];
const HEADERS  = ["اسم الطالب", "الصف", "التاريخ", "اليوم", "الحالة", "المعلمة"];
const STATUSES = ["حاضر", "غائب", "مأذون"];
const DAYS_AR  = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const MAX_RECORDS = 400;
const MAX_LEN     = 120;
const LOCK_MS     = 5000;
const MAX_BATCH   = 20;
const WRITE_LEASE_MS = 30000;
const DATE_CACHE_SEC = 21600;
const DATE_TAIL_ROWS = 600;

const PROP_FOLDER_PREFIX = "GHARS_FOLDER_V3";
const PROP_HIST_PREFIX   = "GHARS_HIST_V3";
const PROP_CLASS_PREFIX  = "GHARS_CLASS_SHEET_V3"; 
const PROP_DATE_PREFIX   = "GHARS_DATE_ROWS_V5";
const PROP_META_PREFIX   = "GHARS_CLASS_META_V5";
const META_TEACHER_KEY   = "GHARS_TEACHER_ID";
const FOLDER_MARKER      = "GHARS_SHEET_ID=";
const WRITE_LEASE_PREFIX = "GHARS_WRITE_LEASE_V51";

/* ====================== بوابة غرس الرقمية ====================== */
// يبقى كود المدير داخل خصائص السكربت، وليس داخل واجهة التطبيق.
// في أول تشغيل تكون القيمة 4646، ثم يمكن تغييرها من لوحة الإدارة.
const PORTAL_ADMIN_ID_PROPERTY = "GHARS_PORTAL_ADMIN_ID";
const PORTAL_AUTH_SECRET_PROPERTY = "GHARS_PORTAL_AUTH_SECRET";
const PORTAL_PLAN_URL_PROPERTY = "GHARS_PORTAL_PLAN_URL";
const PORTAL_TASKS_URL_PROPERTY = "GHARS_PORTAL_TASKS_URL";
const PORTAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PORTAL_VERSION = "1.0.1";
const PORTAL_AI_GAMES_URL = "https://ghars-ai-games.romo7iv.chatgpt.site/";

/* ====================== نقاط الدخول ====================== */

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (!p.action) return json_({ ok: true, service: "ghars-attendance", version: "5.1.2" });
  return route_(p.action, p);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    return json_({ ok: false, code: "BAD_JSON", message: "صيغة البيانات غير صالحة." });
  }
  return route_(body.action, body);
}

function route_(action, data) {
  // login وpull قد ينشئان صفًا أو يطبّقان تعديل Teachers؛ لذلك ليسا قراءة صرفة.
  const READ_ONLY = { ping: 1, portal_admin_list: 1 };

  try {
    if (action === "ping") return json_({ ok: true, ts: Date.now(), version: "5.1.2" });

    const opId = String(data.opId || "").trim();
    if (opId && !READ_ONLY[action]) {
      const cache = CacheService.getScriptCache();
      const hit = cache.get("OP_" + opId);
      if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
    }

    let guard = null;
    if (!READ_ONLY[action]) {
      guard = acquireWriteGuard_(action, data);
      if (!guard) {
        return json_({ ok: false, code: "BUSY", message: "النظام مشغول، أعِد المحاولة." });
      }
    }

    try {
      const ss = getSS_();
      let result;

      if (action === "login") result = opLogin_(ss, data);
      else if (action === "pull") result = opPull_(ss, data);
      else if (action === "portal_login") result = opPortalLogin_(ss, data);
      else if (action === "portal_admin_list") result = opPortalAdminList_(ss, data);
      else if (action === "portal_admin_save_user") result = opPortalAdminSaveUser_(ss, data);
      else if (action === "portal_admin_delete_user") result = opPortalAdminDeleteUser_(ss, data);
      else if (action === "portal_admin_change_code") result = opPortalAdminChangeCode_(ss, data);
      else if (action === "portal_admin_login_as") result = opPortalAdminLoginAs_(ss, data);
      else if (action === "sync_batch") result = opSyncBatch_(ss, data);
      else result = runWriteOperation_(ss, action, data);

      const payload = JSON.stringify(Object.assign({ ok: true }, result));
      if (opId && !READ_ONLY[action]) {
        CacheService.getScriptCache().put("OP_" + opId, payload, 21600); 
      }
      return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);

    } finally {
      releaseWriteGuard_(guard);
    }
  } catch (err) {
    return json_({ ok: false, code: (err && err.code) || "ERROR", message: (err && err.message) || "تعذّر تنفيذ الطلب." });
  }
}

/* ====================== هندسة حفظ الحضور المنيعة (Idempotent Upsert) ====================== */

function opSaveAttendance_(ss, data) {
  const t = mustTeacher_(ss, data);

  const reqDate = isoDate_(data.date || todayIso_());
  const reqDay  = dayNameOf_(reqDate);
  const recs    = Array.isArray(data.records) ? data.records : [];

  if (recs.length === 0) return { inserted: 0, updated: 0, date: reqDate };
  if (recs.length > MAX_RECORDS) throw fail_("TOO_MANY", "عدد السجلات تجاوز الحد.");

  // خريطة تمنع تكرار الطالب داخل الطلب نفسه وتحافظ على آخر اختيار له.
  const byName = {};
  recs.forEach(r => {
    const safeName = req_(r.studentName, "اسم الطالب");
    const safeStatus = req_(r.status, "الحالة");
    if (STATUSES.indexOf(safeStatus) === -1) throw fail_("BAD_STATUS", "حالة حضور غير صالحة.");
    byName[normKey_(safeName)] = { name: safeName, status: safeStatus };
  });

  const sheet = t.classSheet || classSheetFor_(ss, t, true);
  let updatedCount = 0;
  const seen = {};
  let dateRows = locateDateRows_(sheet, reqDate);
  const groups = groupRows_(dateRows);

  // نقرأ ونكتب صفوف هذا اليوم فقط بدل إعادة كتابة سجل الصف كاملًا.
  for (let g = 0; g < groups.length; g++) {
    const block = groups[g];
    const values = sheet.getRange(block.start, 1, block.count, HEADERS.length).getValues();
    const out = [];
    let changed = false;

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const wanted = isoOf_(row[2]) === reqDate ? byName[normKey_(row[0])] : null;
      if (wanted) {
        row[3] = reqDay;
        row[4] = wanted.status;
        row[5] = t.name;
        seen[normKey_(row[0])] = true;
        updatedCount++;
        changed = true;
      }
      out.push([row[3], row[4], row[5]]);
    }
    if (changed) sheet.getRange(block.start, 4, block.count, 3).setValues(out);
  }

  const leftoverKeys = Object.keys(byName).filter(function (k) { return !seen[k]; });
  let insertedCount = 0;
  if (leftoverKeys.length) {
    const previousLastRow = sheet.getLastRow();
    const previousDate = previousLastRow >= 2
      ? isoOf_(sheet.getRange(previousLastRow, 3).getValue())
      : "";
    const start = Math.max(previousLastRow + 1, 2);
    const inserts = leftoverKeys.map(function (k) {
      const item = byName[k];
      return [item.name, t.className, reqDate, reqDay, item.status, t.name];
    });
    const range = sheet.getRange(start, 1, inserts.length, HEADERS.length);
    range.setNumberFormat("@").setValues(inserts);
    // إضافة طلاب لاحقاً إلى حضور اليوم نفسه لا تبدأ مجموعة يوم جديدة.
    // نرسم الفاصل فقط عند الانتقال الحقيقي من تاريخ إلى تاريخ آخر.
    if (start > 2 && previousDate !== reqDate) {
      range.setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    }
    for (let i = 0; i < inserts.length; i++) dateRows.push(start + i);
    insertedCount = inserts.length;
  }

  // locateDateRows_ حدّث الفهرس بالفعل؛ نعيد حفظه فقط إذا أضفنا صفوفًا جديدة.
  if (insertedCount) rememberDateRows_(sheet, reqDate, dateRows);
  return {
    inserted: insertedCount,
    updated: updatedCount,
    date: reqDate,
    className: t.className,
    classSheetId: String(sheet.getSheetId()),
    teacherName: t.name,
    serverTime: Date.now()
  };
}

/* ====================== معالجة شيت الطلاب (حذف وتعديل) ====================== */

function opDeleteStudent_(ss, data) {
  const t    = mustTeacher_(ss, data);
  const name = req_(data.studentName, "اسم الطالب");
  const date = isoDate_(data.date || todayIso_());
  const sh   = mustSheet_(ss, SH_STUDENTS);

  const ck = normKey_(t.className);
  const nk = normKey_(name);
  let deleted = false;
  
  // 1. الحذف من شيت الطلاب
  const stRowCount = sh.getLastRow();
  if (stRowCount > 1) {
    const stVals = sh.getRange(2, 1, stRowCount - 1, 2).getValues();
    for (let i = stVals.length - 1; i >= 0; i--) {
      if (normKey_(stVals[i][0]) === ck && normKey_(stVals[i][1]) === nk) {
        sh.deleteRow(i + 2); // i+2 لأن النطاق يبدأ من الصف 2
        deleted = true;
        break; // نحذف واحد فقط في ورقة الطلاب
      }
    }
  }

  // نحذف تسجيل الطالب في اليوم المطلوب فقط، ونبقي الأيام السابقة محفوظة.
  const cls = t.classSheet || classSheetFor_(ss, t, false);
  const attendanceRows = [];
  if (cls && cls.getLastRow() > 1) {
    const groups = groupRows_(locateDateRows_(cls, date));
    for (let g = 0; g < groups.length; g++) {
      const block = groups[g];
      const names = cls.getRange(block.start, 1, block.count, 1).getValues();
      for (let i = 0; i < names.length; i++) {
        if (normKey_(names[i][0]) === nk) attendanceRows.push(block.start + i);
      }
    }
    attendanceRows.sort(function (a, b) { return b - a; });
    for (let i = 0; i < attendanceRows.length; i++) cls.deleteRow(attendanceRows[i]);
    if (attendanceRows.length) forgetDateRows_(cls, date);
  }

  return {
    deleted: deleted || attendanceRows.length > 0,
    rosterDeleted: deleted,
    attendanceDeleted: attendanceRows.length,
    date: date,
    historyPreserved: true
  };
}

function opRenameStudent_(ss, data) {
  const t       = mustTeacher_(ss, data);
  const oldName = req_(data.oldName, "الاسم القديم");
  const newName = req_(data.newName, "الاسم الجديد");
  if (normKey_(oldName) === normKey_(newName) && oldName === newName) return { changed: false };

  const sh = mustSheet_(ss, SH_STUDENTS);
  const stRowCount = sh.getLastRow();
  const ck = normKey_(t.className);
  const ok = normKey_(oldName);
  const nk = normKey_(newName);

  let found = false;
  if (stRowCount > 1) {
    const stRange = sh.getRange(2, 1, stRowCount - 1, 2);
    const stVals = stRange.getValues();
    for (let i = 0; i < stVals.length; i++) {
      if (normKey_(stVals[i][0]) === ck && normKey_(stVals[i][1]) === nk && normKey_(stVals[i][1]) !== ok) {
        throw fail_("DUPLICATE", "يوجد طالب آخر بهذا الاسم.");
      }
    }
    for (let i = 0; i < stVals.length; i++) {
      if (normKey_(stVals[i][0]) === ck && normKey_(stVals[i][1]) === ok) {
        stVals[i][1] = newName;
        found = true;
      }
    }
    if (found) {
        stRange.setNumberFormat("@");
        stRange.setValues(stVals);
    }
  }
  
  if (!found) {
    // إعادة إرسال العملية بعد نجاحها سابقاً لا تُعد خطأ.
    const already = stRowCount > 1 && sh.getRange(2, 1, stRowCount - 1, 2).getValues().some(function (r) {
      return normKey_(r[0]) === ck && normKey_(r[1]) === nk;
    });
    if (already) return { changed: false, alreadyApplied: true };
    throw fail_("NOT_FOUND", "الطالب غير موجود في القائمة.");
  }

  // التعديل في شيت الصف
  const cls = t.classSheet || classSheetFor_(ss, t, false);
  let touched = 0;
  if (cls) {
    const clsRowCount = cls.getLastRow();
    if (clsRowCount > 1) {
      const clsRange = cls.getRange(2, 1, clsRowCount - 1, 1);
      const clsVals = clsRange.getValues();
      let clsChanged = false;
      for (let i = 0; i < clsVals.length; i++) {
        if (normKey_(clsVals[i][0]) === ok) {
          clsVals[i][0] = newName;
          clsChanged = true;
          touched++;
        }
      }
      if (clsChanged) {
          clsRange.setNumberFormat("@");
          clsRange.setValues(clsVals);
      }
    }
  }

  return { changed: true, recordsUpdated: touched };
}

function opRenameClass_(ss, data) {
  const teacherId = req_(data.teacherId, "رقم المعلمة");
  const newName   = validClassName_(data.newName);
  const t = findTeacher_(ss, teacherId);
  if (!t) throw fail_("NOT_FOUND", "الرقم غير موجود.");

  const oldName = t.className;
  if (oldName === newName) return { changed: false, className: newName };

  const mine  = classSheetFor_(ss, t, false);
  const clash = findClassSheet_(ss, newName);
  if (clash && (!mine || clash.getSheetId() !== mine.getSheetId())) {
    throw fail_("DUPLICATE", "يوجد صف آخر بنفس الاسم: " + newName);
  }

  t.sheet.getRange(t.row, 3).setNumberFormat("@").setValue(newName);

  let sheetId;
  if (mine) {
    sheetId = mine.getSheetId();
    mine.setName(newName);
    mine.setRightToLeft(true);
    const clsRowCount = mine.getLastRow();
    if (clsRowCount > 1) {
      const clsRange = mine.getRange(2, 2, clsRowCount - 1, 1);
      const clsVals = clsRange.getValues();
      for(let i=0; i<clsVals.length; i++) clsVals[i][0] = newName;
      clsRange.setNumberFormat("@");
      clsRange.setValues(clsVals);
    }
  } else {
    const created = ensureClassSheet_(ss, newName);
    sheetId = created.getSheetId();
  }
  rememberClassSheet_(t.id, sheetByGid_(ss, sheetId) || sheetId); 

  if (oldName) {
    const sh = mustSheet_(ss, SH_STUDENTS);
    const stRowCount = sh.getLastRow();
    if(stRowCount > 1){
      const stRange = sh.getRange(2, 1, stRowCount - 1, 1);
      const stVals = stRange.getValues();
      let stChanged = false;
      const ok = normKey_(oldName);
      for (let i = 0; i < stVals.length; i++) {
        if (normKey_(stVals[i][0]) === ok) {
          stVals[i][0] = newName;
          stChanged = true;
        }
      }
      if(stChanged) {
          stRange.setNumberFormat("@");
          stRange.setValues(stVals);
      }
    }
  }

  if (oldName) {
    rememberOldName_(String(sheetId), oldName);
    try { syncFoldersAfterRename_(String(sheetId), oldName, newName); }
    catch (e) { console.error("Drive sync: " + e); }
  }

  return { changed: true, className: newName };
}

/* ====================== باقي دوال النظام החيوية ====================== */

function opLogin_(ss, data) {
  const teacherId = req_(data.teacherId, "رقم المعلمة");
  const t = findTeacher_(ss, teacherId);
  if (!t) throw fail_("NOT_FOUND", "الرقم غير موجود.");
  let created = false;
  if (!t.className) {
    t.className = buildAutoClassName_(ss, t.name, teacherId);
    t.sheet.getRange(t.row, 3).setNumberFormat("@").setValue(t.className);
    created = true;
  }
  const sheet = classSheetFor_(ss, t, true);
  const date = data.date ? isoDate_(data.date) : todayIso_();
  const roster = readRoster_(ss, t.className);
  const marks  = readMarksFromSheet_(sheet, date);
  return { teacherId: teacherId, teacherName: t.name, className: t.className, classSheetId: String(sheet.getSheetId()), classCreated: created, students: roster, date: date, attendance: marks.map, submitted: marks.count > 0, serverDate: todayIso_(), serverTime: Date.now(), version: "5.1.2" };
}

/* ====================== دخول وصلاحيات غرس الرقمية ====================== */

function portalAdminId_() {
  const props = PropertiesService.getScriptProperties();
  let id = String(props.getProperty(PORTAL_ADMIN_ID_PROPERTY) || "").trim();
  if (!id) {
    id = "4646";
    props.setProperty(PORTAL_ADMIN_ID_PROPERTY, id);
  }
  return id;
}

function portalAuthSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = String(props.getProperty(PORTAL_AUTH_SECRET_PROPERTY) || "").trim();
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    props.setProperty(PORTAL_AUTH_SECRET_PROPERTY, secret);
  }
  return secret;
}

function portalBase64Text_(value) {
  return Utilities.base64EncodeWebSafe(String(value || ""), Utilities.Charset.UTF_8);
}

function portalBase64Bytes_(value) {
  return Utilities.base64EncodeWebSafe(value);
}

function portalDecodeText_(value) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(String(value || ""))).getDataAsString();
}

function portalSignature_(body) {
  return portalBase64Bytes_(Utilities.computeHmacSha256Signature(
    String(body || ""), portalAuthSecret_(), Utilities.Charset.UTF_8));
}

function portalSafeEquals_(left, right) {
  const a = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(left || ""), Utilities.Charset.UTF_8);
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(right || ""), Utilities.Charset.UTF_8);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function issuePortalAdminToken_(teacherId) {
  const expiresAt = Date.now() + PORTAL_TOKEN_TTL_MS;
  const payload = JSON.stringify({ v: 1, teacherId: String(teacherId), role: "admin", exp: expiresAt });
  const body = portalBase64Text_(payload);
  return { token: body + "." + portalSignature_(body), expiresAt: expiresAt };
}

function requirePortalAdmin_(data) {
  const token = String(data && data.authToken || "").trim();
  const parts = token.split(".");
  if (parts.length !== 2 || !portalSafeEquals_(portalSignature_(parts[0]), parts[1])) {
    throw fail_("UNAUTHORIZED", "انتهت جلسة الإدارة أو أنها غير صالحة. سجّل الدخول من جديد.");
  }
  let payload;
  try { payload = JSON.parse(portalDecodeText_(parts[0])); }
  catch (_) { throw fail_("UNAUTHORIZED", "جلسة الإدارة غير صالحة."); }
  if (!payload || payload.role !== "admin" || Number(payload.exp || 0) <= Date.now()) {
    throw fail_("UNAUTHORIZED", "انتهت جلسة الإدارة. سجّل الدخول من جديد.");
  }
  if (normKey_(payload.teacherId) !== normKey_(portalAdminId_())) {
    throw fail_("UNAUTHORIZED", "تم تغيير كود المدير. سجّل الدخول بالكود الجديد.");
  }
  return payload;
}

function validPortalId_(value) {
  const id = req_(value, "كود الدخول");
  if (!/^[A-Za-z0-9_\-\u0660-\u0669\u06F0-\u06F9]{3,24}$/.test(id)) {
    throw fail_("BAD_CODE", "الكود يقبل الحروف الإنجليزية والأرقام والشرطة فقط، من 3 إلى 24 محرفًا.");
  }
  return id;
}

function portalLoginPayload_(base, role) {
  const output = Object.assign({}, base, {
    role: role,
    portalVersion: PORTAL_VERSION,
    moduleLinks: portalModuleLinks_()
  });
  if (role === "admin") {
    const issued = issuePortalAdminToken_(base.teacherId);
    output.authToken = issued.token;
    output.authExpiresAt = issued.expiresAt;
  }
  return output;
}

function portalModuleLinks_() {
  const props = PropertiesService.getScriptProperties();
  return {
    games: PORTAL_AI_GAMES_URL,
    plans: String(props.getProperty(PORTAL_PLAN_URL_PROPERTY) || "").trim(),
    tasks: String(props.getProperty(PORTAL_TASKS_URL_PROPERTY) || "").trim()
  };
}

function opPortalLogin_(ss, data) {
  const base = opLogin_(ss, data);
  const role = normKey_(base.teacherId) === normKey_(portalAdminId_()) ? "admin" : "teacher";
  return portalLoginPayload_(base, role);
}

function opPortalAdminList_(ss, data) {
  requirePortalAdmin_(data);
  const sheet = mustSheet_(ss, SH_TEACHERS);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  const adminKey = normKey_(portalAdminId_());
  const teachers = [];
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0] || "").trim();
    if (!id) continue;
    const key = normKey_(id);
    if (seen[key]) throw fail_("DUPLICATE", "يوجد كود مكرر في ورقة Teachers: " + id);
    seen[key] = true;
    teachers.push({
      teacherId: id,
      teacherName: String(rows[i][1] || id).trim(),
      className: String(rows[i][2] || "").trim(),
      role: key === adminKey ? "admin" : "teacher"
    });
  }
  teachers.sort(function (a, b) {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.teacherName.localeCompare(b.teacherName, "ar");
  });
  return { teachers: teachers, count: teachers.length, portalVersion: PORTAL_VERSION };
}

function portalMoveTeacherId_(ss, teacher, newId) {
  const oldId = String(teacher.id || "").trim();
  if (normKey_(oldId) === normKey_(newId)) return teacher;
  if (findTeacher_(ss, newId)) throw fail_("DUPLICATE", "هذا الكود مستخدم بالفعل.");

  const classSheet = teacher.className ? classSheetFor_(ss, teacher, false) : null;
  teacher.sheet.getRange(teacher.row, 1).setNumberFormat("@").setValue(newId);
  const props = PropertiesService.getScriptProperties();
  const oldKey = normKey_(oldId);
  const newKey = normKey_(newId);
  const oldClassKey = PROP_CLASS_PREFIX + ":" + oldKey;
  const newClassKey = PROP_CLASS_PREFIX + ":" + newKey;
  const oldMetaKey = PROP_META_PREFIX + ":" + oldKey;
  const newMetaKey = PROP_META_PREFIX + ":" + newKey;
  const savedSheetId = props.getProperty(oldClassKey);
  const savedMeta = props.getProperty(oldMetaKey);
  if (savedSheetId) props.setProperty(newClassKey, savedSheetId);
  if (savedMeta) props.setProperty(newMetaKey, savedMeta);
  props.deleteProperty(oldClassKey);
  props.deleteProperty(oldMetaKey);

  if (classSheet) {
    const metadata = classSheet.getDeveloperMetadata();
    for (let i = 0; i < metadata.length; i++) {
      if (metadata[i].getKey() === META_TEACHER_KEY && normKey_(metadata[i].getValue()) === oldKey) {
        metadata[i].setValue(String(newId));
      }
    }
    rememberClassSheet_(newId, classSheet);
  }
  return findTeacher_(ss, newId);
}

function opPortalAdminSaveUser_(ss, data) {
  requirePortalAdmin_(data);
  const id = validPortalId_(data.teacherId);
  const originalId = String(data.originalTeacherId || "").trim();
  const name = req_(data.teacherName, "اسم المستخدم");
  const className = validClassName_(data.className);
  const adminKey = normKey_(portalAdminId_());

  if (!originalId) {
    if (findTeacher_(ss, id)) throw fail_("DUPLICATE", "هذا الكود مستخدم بالفعل.");
    if (classNameTaken_(ss, className)) throw fail_("DUPLICATE", "هذا الصف مرتبط بكود آخر.");
    const sheet = mustSheet_(ss, SH_TEACHERS);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setNumberFormat("@").setValues([[id, name, className]]);
    return { created: true, teacherId: id, teacherName: name, className: className, role: "teacher" };
  }

  let teacher = findTeacher_(ss, validPortalId_(originalId));
  if (!teacher) throw fail_("NOT_FOUND", "الكود المطلوب تعديله غير موجود.");
  if (normKey_(teacher.id) === adminKey && normKey_(id) !== adminKey) {
    throw fail_("ADMIN_CODE", "غيّر كود المدير من زر «تغيير كود المدير».");
  }
  if (normKey_(teacher.id) !== normKey_(id)) teacher = portalMoveTeacherId_(ss, teacher, id);
  if (normKey_(teacher.name) !== normKey_(name)) opRenameTeacher_(ss, { teacherId: id, newName: name });
  teacher = findTeacher_(ss, id);
  if (String(teacher.className) !== String(className)) opRenameClass_(ss, { teacherId: id, newName: className });
  return { created: false, teacherId: id, teacherName: name, className: className, role: normKey_(id) === adminKey ? "admin" : "teacher" };
}

function portalDetachTeacher_(teacher) {
  const props = PropertiesService.getScriptProperties();
  const idKey = normKey_(teacher.id);
  const classKey = PROP_CLASS_PREFIX + ":" + idKey;
  const metaKey = PROP_META_PREFIX + ":" + idKey;
  const sheetId = props.getProperty(classKey);
  const ss = teacher.sheet.getParent();
  const classSheet = sheetId ? sheetByGid_(ss, sheetId) : sheetByTeacherMetadata_(ss, teacher.id);
  if (classSheet) {
    const metadata = classSheet.getDeveloperMetadata();
    for (let i = metadata.length - 1; i >= 0; i--) {
      if (metadata[i].getKey() === META_TEACHER_KEY && normKey_(metadata[i].getValue()) === idKey) metadata[i].remove();
    }
  }
  props.deleteProperty(classKey);
  props.deleteProperty(metaKey);
}

function opPortalAdminDeleteUser_(ss, data) {
  requirePortalAdmin_(data);
  const id = validPortalId_(data.teacherId);
  if (normKey_(id) === normKey_(portalAdminId_())) throw fail_("ADMIN_CODE", "لا يمكن حذف كود المدير.");
  const teacher = findTeacher_(ss, id);
  if (!teacher) throw fail_("NOT_FOUND", "الكود غير موجود.");
  portalDetachTeacher_(teacher);
  teacher.sheet.deleteRow(teacher.row);
  return { deleted: true, teacherId: id, dataPreserved: true };
}

function opPortalAdminChangeCode_(ss, data) {
  const session = requirePortalAdmin_(data);
  const currentId = portalAdminId_();
  const newId = validPortalId_(data.newAdminId);
  if (normKey_(currentId) !== normKey_(newId) && findTeacher_(ss, newId)) {
    throw fail_("DUPLICATE", "الكود الجديد مستخدم بالفعل.");
  }
  let teacher = findTeacher_(ss, currentId);
  if (!teacher) throw fail_("NOT_FOUND", "صف المدير غير موجود في ورقة Teachers.");
  if (normKey_(currentId) !== normKey_(newId)) teacher = portalMoveTeacherId_(ss, teacher, newId);
  PropertiesService.getScriptProperties().setProperty(PORTAL_ADMIN_ID_PROPERTY, newId);
  const base = opLogin_(ss, { teacherId: newId, date: data.date || todayIso_() });
  return portalLoginPayload_(base, "admin");
}

function opPortalAdminLoginAs_(ss, data) {
  requirePortalAdmin_(data);
  const targetId = validPortalId_(data.teacherId);
  const base = opLogin_(ss, { teacherId: targetId, date: data.date || todayIso_() });
  return Object.assign({}, base, { impersonatedByAdmin: true, portalVersion: PORTAL_VERSION, moduleLinks: portalModuleLinks_() });
}

function opPull_(ss, data) {
  const teacherId = req_(data.teacherId, "رقم المعلمة");
  const t = findTeacher_(ss, teacherId);
  if (!t) throw fail_("NOT_FOUND", "الرقم غير موجود.");
  if (!t.className) return opLogin_(ss, data);
  const sheet  = classSheetFor_(ss, t, true);
  const date   = data.date ? isoDate_(data.date) : todayIso_();
  const roster = readRoster_(ss, t.className);
  const marks  = readMarksFromSheet_(sheet, date);
  return { teacherId: teacherId, teacherName: t.name, className: t.className, classSheetId: String(sheet.getSheetId()), students: roster, date: date, attendance: marks.map, submitted: marks.count > 0, serverDate: todayIso_(), serverTime: Date.now(), version: "5.1.2" };
}

function opAddStudent_(ss, data) {
  const t    = mustTeacher_(ss, data);
  const name = req_(data.studentName, "اسم الطالب");
  const sh   = mustSheet_(ss, SH_STUDENTS);
  
  if (sh.getLastRow() > 1) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); 
    const ck   = normKey_(t.className);
    for (let i = 0; i < rows.length; i++) {
      if (normKey_(rows[i][0]) === ck && normKey_(rows[i][1]) === normKey_(name)) return { duplicate: true, studentName: rows[i][1] };
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setNumberFormat("@").setValues([[t.className, name]]);
  return { duplicate: false, studentName: name };
}

function opRenameTeacher_(ss, data) {
  const teacherId = req_(data.teacherId, "رقم المعلمة");
  const newName   = req_(data.newName, "الاسم الجديد");
  const t = findTeacher_(ss, teacherId);
  if (!t) throw fail_("NOT_FOUND", "الرقم غير موجود.");
  if (t.name === newName) return { changed: false, teacherName: newName };

  t.sheet.getRange(t.row, 2).setNumberFormat("@").setValue(newName);
  const cls = t.className ? classSheetFor_(ss, t, false) : null;
  if (cls) {
    const clsRowCount = cls.getLastRow();
    if (clsRowCount > 1) {
      const clsRange = cls.getRange(2, 6, clsRowCount - 1, 1);
      const clsVals = clsRange.getValues();
      let changed = false;
      for (let i = 0; i < clsVals.length; i++) {
        if (normKey_(clsVals[i][0]) === normKey_(t.name)) {
          clsVals[i][0] = newName;
          changed = true;
        }
      }
      if (changed) {
          clsRange.setNumberFormat("@");
          clsRange.setValues(clsVals);
      }
    }
  }
  return { changed: true, teacherName: newName };
}

function readRoster_(ss, className) {
  const sh = ss.getSheetByName(SH_STUDENTS);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues(); 
  const ck   = normKey_(className);
  const out  = [];
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    if (normKey_(rows[i][0]) !== ck) continue;
    const name = String(rows[i][1]).trim();
    if (!name) continue;
    const k = normKey_(name);
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(name);
  }
  return out;
}

function readMarksFromSheet_(sh, isoDay) {
  const map = {};
  let count = 0;
  if (!sh || sh.getLastRow() < 2) return { map: map, count: 0 };
  const groups = groupRows_(locateDateRows_(sh, isoDay));
  for (let g = 0; g < groups.length; g++) {
    const block = groups[g];
    const rows = sh.getRange(block.start, 1, block.count, HEADERS.length).getValues();
    for (let i = 0; i < rows.length; i++) {
      if (isoOf_(rows[i][2]) !== isoDay) continue;
      const name = String(rows[i][0]).trim();
      const st   = String(rows[i][4]).trim();
      if (name && STATUSES.indexOf(st) !== -1) { map[name] = st; count++; }
    }
  }
  return { map: map, count: count };
}

function dateRowsKey_(sheet, isoDay) {
  return "GHARS_DATE_CACHE_V51:" + sheet.getSheetId() + ":" + isoDay;
}

function rememberDateRows_(sheet, isoDay, rows) {
  const cleanRows = Array.from(new Set((rows || []).map(Number).filter(function (n) {
    return isFinite(n) && n >= 2;
  }))).sort(function (a, b) { return a - b; }).slice(0, MAX_RECORDS * 2);
  CacheService.getScriptCache().put(dateRowsKey_(sheet, isoDay), JSON.stringify({
    lastRow: sheet.getLastRow(),
    rows: cleanRows
  }), DATE_CACHE_SEC);
}

function forgetDateRows_(sheet, isoDay) {
  CacheService.getScriptCache().remove(dateRowsKey_(sheet, isoDay));
}

/** يستعمل فهرساً مؤقتاً سريعاً لكل يوم، فلا تتراكم آلاف المفاتيح خلال الفصل.
 * يبدأ البحث من آخر السجل؛ ويقرأ التاريخ الكامل فقط عند طلب يوم قديم. */
function locateDateRows_(sheet, isoDay) {
  const cache = CacheService.getScriptCache();
  const key = dateRowsKey_(sheet, isoDay);
  const last = sheet.getLastRow();
  let saved = null;
  try { saved = JSON.parse(cache.get(key) || "null"); } catch (_) {}
  if (Array.isArray(saved)) saved = { lastRow: 0, rows: saved }; // ترقية فهرس تجريبي قديم

  if (saved && Array.isArray(saved.rows) && saved.rows.length === 0 && Number(saved.lastRow) === last) return [];
  if (saved && Array.isArray(saved.rows) && saved.rows.length && saved.rows.every(function (n) { return Number(n) >= 2 && Number(n) <= last; })) {
    const normalized = saved.rows.map(Number).sort(function (a, b) { return a - b; });
    if (dateRowsStillValid_(sheet, isoDay, normalized)) return normalized;
  }

  if (last < 2) {
    rememberDateRows_(sheet, isoDay, []);
    return [];
  }

  const tailCount = Math.min(last - 1, DATE_TAIL_ROWS);
  const tailStart = last - tailCount + 1;
  const dates = sheet.getRange(tailStart, 3, tailCount, 1).getValues();
  const found = [];
  let maxTailDate = "";
  for (let i = 0; i < dates.length; i++) {
    const value = isoOf_(dates[i][0]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value > maxTailDate) maxTailDate = value;
    if (value === isoDay) found.push(tailStart + i);
  }

  if (!found.length && tailStart > 2 && (!maxTailDate || isoDay <= maxTailDate)) {
    const older = sheet.getRange(2, 3, tailStart - 2, 1).getValues();
    for (let i = 0; i < older.length; i++) if (isoOf_(older[i][0]) === isoDay) found.push(i + 2);
  }
  rememberDateRows_(sheet, isoDay, found);
  return found;
}

function dateRowsStillValid_(sheet, isoDay, rows) {
  const groups = groupRows_(rows);
  let checked = 0;
  for (let g = 0; g < groups.length; g++) {
    const block = groups[g];
    const values = sheet.getRange(block.start, 3, block.count, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (isoOf_(values[i][0]) !== isoDay) return false;
      checked++;
    }
  }
  return checked === rows.length;
}

function groupRows_(rows) {
  const list = Array.from(new Set((rows || []).map(Number).filter(function (n) { return isFinite(n); })))
    .sort(function (a, b) { return a - b; });
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const last = out.length ? out[out.length - 1] : null;
    if (last && last.start + last.count === n) last.count++;
    else out.push({ start: n, count: 1 });
  }
  return out;
}

function getSS_() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw fail_("NO_SS", "لم يتم ربط السكربت بجدول البيانات.");
  return ss;
}

function mustSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw fail_("NO_SHEET", "ورقة " + name + " غير موجودة.");
  return sh;
}

function mustTeacher_(ss, data) {
  const id = req_(data.teacherId, "رقم المعلمة");
  const t  = findTeacher_(ss, id);
  if (!t) throw fail_("NOT_FOUND", "الرقم غير موجود.");
  if (!t.className) {
    t.className = buildAutoClassName_(ss, t.name, id);
    t.sheet.getRange(t.row, 3).setNumberFormat("@").setValue(t.className);
  }
  t.classSheet = classSheetFor_(ss, t, true);
  verifyRequestBinding_(t, data || {});
  return t;
}

function verifyRequestBinding_(t, data) {
  const expectedSheetId = clean_(data.classSheetId || "", 40);
  if (expectedSheetId && String(t.classSheet.getSheetId()) !== expectedSheetId) {
    throw fail_("STALE_BINDING", "تغيّر ربط الصف منذ آخر تحديث. حدّثي البيانات ثم أعيدي التسليم.");
  }
  const expectedClass = clean_(data.className || "", 90);
  if (!expectedSheetId && expectedClass && normKey_(expectedClass) !== normKey_(t.className)) {
    throw fail_("STALE_BINDING", "تغيّر الصف منذ آخر تحديث. حدّثي البيانات ثم أعيدي التسليم.");
  }
}

function findTeacher_(ss, teacherId) {
  const sh = mustSheet_(ss, SH_TEACHERS);
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues(); 
  const key  = normKey_(teacherId);
  let found = null;
  for (let i = 0; i < rows.length; i++) {
    if (normKey_(rows[i][0]) !== key) continue;
    if (found) throw fail_("DUPLICATE", "كود المعلمة مكرر في ورقة Teachers. يجب أن يكون كل كود فريدًا.");
    found = { sheet: sh, row: i + 2, id: String(rows[i][0]).trim(), name: String(rows[i][1] || rows[i][0]).trim(), className: String(rows[i][2] || "").trim() };
  }
  if (!found || !found.className) return found;

  const classKey = normKey_(found.className);
  for (let i = 0; i < rows.length; i++) {
    if (i + 2 === found.row || !rows[i][2]) continue;
    if (normKey_(rows[i][2]) === classKey && normKey_(rows[i][0]) !== key) {
      throw fail_("DUPLICATE", "الصف «" + found.className + "» مرتبط بأكثر من كود في ورقة Teachers.");
    }
  }
  return found;
}

function findClassSheet_(ss, className) {
  const name = String(className || "").trim();
  if (!name) return null;
  const direct = ss.getSheetByName(name);
  if (direct) return direct;
  const key = normKey_(name);
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) {
    const n = all[i].getName();
    if (SYSTEM_SHEETS.indexOf(n) !== -1) continue;
    if (normKey_(n) === key) return all[i];
  }
  return null;
}

function classSheetFor_(ss, t, createIfMissing) {
  const props = PropertiesService.getScriptProperties();
  const key   = PROP_CLASS_PREFIX + ":" + normKey_(t.id);
  const saved = props.getProperty(key);
  if (saved) {
    const byGid = sheetByGid_(ss, saved);
    if (byGid) {
      verifyClassSheetBinding_(byGid, t.id);
      reconcileClassSheet_(ss, t, byGid);
      return byGid;
    }
    props.deleteProperty(key); 
  }

  const byMeta = sheetByTeacherMetadata_(ss, t.id);
  if (byMeta) {
    rememberClassSheet_(t.id, byMeta);
    reconcileClassSheet_(ss, t, byMeta);
    return byMeta;
  }

  const byName = t.className ? findClassSheet_(ss, t.className) : null;
  if (byName) {
    rememberClassSheet_(t.id, byName);
    reconcileClassSheet_(ss, t, byName);
    return byName;
  }
  if (createIfMissing && t.className) {
    const created = ensureClassSheet_(ss, t.className);
    rememberClassSheet_(t.id, created);
    reconcileClassSheet_(ss, t, created);
    return created;
  }
  return null;
}

function rememberClassSheet_(teacherId, sheetOrId) {
  const sheetId = (sheetOrId && typeof sheetOrId.getSheetId === "function") ? sheetOrId.getSheetId() : sheetOrId;
  if (sheetOrId && typeof sheetOrId.getDeveloperMetadata === "function") {
    verifyClassSheetBinding_(sheetOrId, teacherId);
  }
  PropertiesService.getScriptProperties().setProperty(PROP_CLASS_PREFIX + ":" + normKey_(teacherId), String(sheetId));
}

function bindingCacheKey_(sheet, teacherId) {
  return "GHARS_BIND_OK_V51:" + sheet.getSheetId() + ":" + normKey_(teacherId);
}

function verifyClassSheetBinding_(sheet, teacherId) {
  const cache = CacheService.getScriptCache();
  const key = bindingCacheKey_(sheet, teacherId);
  if (cache.get(key)) return;
  assertUniqueSheetMapping_(sheet, teacherId);
  tagClassSheet_(sheet, teacherId);
  cache.put(key, "1", DATE_CACHE_SEC);
}

function assertUniqueSheetMapping_(sheet, teacherId) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const prefix = PROP_CLASS_PREFIX + ":";
  const ownKey = prefix + normKey_(teacherId);
  const sheetId = String(sheet.getSheetId());
  const keys = Object.keys(props);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) !== 0 || keys[i] === ownKey) continue;
    if (String(props[keys[i]]) === sheetId) {
      throw fail_("DUPLICATE", "ورقة الصف «" + sheet.getName() + "» مرتبطة بأكثر من كود معلمة.");
    }
  }
}

function sheetByTeacherMetadata_(ss, teacherId) {
  const wanted = normKey_(teacherId);
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (SYSTEM_SHEETS.indexOf(sheets[i].getName()) !== -1) continue;
    const metadata = sheets[i].getDeveloperMetadata();
    for (let j = 0; j < metadata.length; j++) {
      if (metadata[j].getKey() === META_TEACHER_KEY && normKey_(metadata[j].getValue()) === wanted) return sheets[i];
    }
  }
  return null;
}

function tagClassSheet_(sheet, teacherId) {
  const wanted = String(teacherId).trim();
  const metadata = sheet.getDeveloperMetadata();
  let alreadyTagged = false;
  for (let i = 0; i < metadata.length; i++) {
    if (metadata[i].getKey() !== META_TEACHER_KEY) continue;
    if (normKey_(metadata[i].getValue()) === normKey_(wanted)) alreadyTagged = true;
    else throw fail_("DUPLICATE", "ورقة الصف «" + sheet.getName() + "» مرتبطة مسبقًا بكود معلمة آخر.");
  }
  if (alreadyTagged) return;
  sheet.addDeveloperMetadata(META_TEACHER_KEY, wanted);
}

/** يجعل ورقة Teachers هي المصدر الوحيد لاسم المعلمة والصف، مع إبقاء نفس
 * ورقة الصف ومعرّفها. لا تُنشأ ورقة جديدة لمجرد تغيير الاسم. */
function reconcileClassSheet_(ss, t, sheet) {
  if (!sheet || !t.className) return;
  const desiredClass = validClassName_(t.className);
  const oldClass = sheet.getName();
  const reconcileCache = CacheService.getScriptCache();
  const reconcileKey = "GHARS_RECONCILE_V51:" + normKey_(t.id);
  const fingerprint = [sheet.getSheetId(), t.name, desiredClass].join("|");
  if (oldClass === desiredClass && reconcileCache.get(reconcileKey) === fingerprint) return;

  const props = PropertiesService.getScriptProperties();
  const metaKey = PROP_META_PREFIX + ":" + normKey_(t.id);
  let previous = {};
  try { previous = JSON.parse(props.getProperty(metaKey) || "{}"); } catch (_) {}

  const bindingUnchanged = String(previous.sheetId || "") === String(sheet.getSheetId()) &&
    normKey_(previous.teacherName) === normKey_(t.name) &&
    String(previous.className || "") === desiredClass &&
    oldClass === desiredClass;
  if (bindingUnchanged) {
    reconcileCache.put(reconcileKey, fingerprint, DATE_CACHE_SEC);
    return;
  }

  if (oldClass !== desiredClass) {
    const clash = findClassSheet_(ss, desiredClass);
    if (clash && clash.getSheetId() !== sheet.getSheetId()) {
      throw fail_("DUPLICATE", "يوجد صف آخر بنفس الاسم: " + desiredClass);
    }
    sheet.setName(desiredClass);
    rememberOldName_(String(sheet.getSheetId()), oldClass);
    replaceColumnValue_(sheet, 2, oldClass, desiredClass, true);
    replaceRosterClass_(ss, oldClass, desiredClass);
  }

  if (!previous.teacherName || normKey_(previous.teacherName) !== normKey_(t.name)) {
    replaceTeacherColumn_(sheet, t.name);
  }

  props.setProperty(metaKey, JSON.stringify({
    sheetId: String(sheet.getSheetId()),
    teacherName: t.name,
    className: desiredClass
  }));
  reconcileCache.put(reconcileKey, fingerprint, DATE_CACHE_SEC);
}

function replaceColumnValue_(sheet, column, oldValue, newValue, onlyOld) {
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return;
  const range = sheet.getRange(2, column, count, 1);
  const values = range.getValues();
  const oldKey = normKey_(oldValue);
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (!onlyOld || normKey_(values[i][0]) === oldKey) {
      if (String(values[i][0]) !== String(newValue)) {
        values[i][0] = newValue;
        changed = true;
      }
    }
  }
  if (changed) range.setNumberFormat("@").setValues(values);
}

function replaceTeacherColumn_(sheet, teacherName) {
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return;
  const range = sheet.getRange(2, 6, count, 1);
  const values = range.getValues();
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) !== teacherName) {
      values[i][0] = teacherName;
      changed = true;
    }
  }
  if (changed) range.setNumberFormat("@").setValues(values);
}

function replaceRosterClass_(ss, oldClass, newClass) {
  const sheet = mustSheet_(ss, SH_STUDENTS);
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return;
  const range = sheet.getRange(2, 1, count, 1);
  const values = range.getValues();
  const oldKey = normKey_(oldClass);
  let changed = false;
  for (let i = 0; i < values.length; i++) {
    if (normKey_(values[i][0]) === oldKey) {
      values[i][0] = newClass;
      changed = true;
    }
  }
  if (changed) range.setNumberFormat("@").setValues(values);
}

function sheetByGid_(ss, gid) {
  const num = Number(gid);
  if (isNaN(num)) return null;
  const all = ss.getSheets();
  for (let i = 0; i < all.length; i++) {
    if (all[i].getSheetId() === num) return all[i];
  }
  return null;
}

function ensureClassSheet_(ss, className) {
  let sh = findClassSheet_(ss, className);
  if (sh) {
    if (sh.getLastRow() === 0) writeHeaders_(sh);
    return sh;
  }
  // نضيف أوراق الصفوف في نهاية القائمة حتى لا تدخل بين Teachers وStudents.
  sh = ss.insertSheet(className, ss.getNumSheets());
  writeHeaders_(sh);
  pinSystemSheets_(ss);
  return sh;
}

/** شغّل هذه الدالة مرة واحدة لترتيب الأوراق الموجودة حاليًا. */
function pinSystemSheets() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) throw fail_("BUSY", "النظام مشغول، أعد المحاولة بعد قليل.");
  try {
    const ok = pinSystemSheets_(getSS_());
    if (!ok) throw fail_("NO_SHEET", "يجب وجود ورقتي Teachers وStudents.");
    return "تم تثبيت Teachers وStudents في أقصى اليمين.";
  } finally {
    lock.releaseLock();
  }
}

function pinSystemSheets_(ss) {
  const teachers = ss.getSheetByName(SH_TEACHERS);
  const students = ss.getSheetByName(SH_STUDENTS);
  if (!teachers || !students) return false;

  const previousActive = ss.getActiveSheet();
  ss.setActiveSheet(teachers);
  ss.moveActiveSheet(1);
  ss.setActiveSheet(students);
  ss.moveActiveSheet(2);
  if (previousActive) ss.setActiveSheet(previousActive, true);
  return true;
}

function writeHeaders_(sh) {
  sh.setRightToLeft(true);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setBackground("#8E1F6E").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 190);
  sh.setColumnWidth(2, 170);
}

function buildAutoClassName_(ss, teacherName, teacherId) {
  const first = String(teacherName || "").replace(/^(أ|أ\.|الأستاذة|المعلمة)\s*/, "").trim().split(/\s+/)[0];
  const base = "ركن " + (first || String(teacherId));
  let name = base, i = 2;
  while (findClassSheet_(ss, name) || classNameTaken_(ss, name)) {
    name = base + " (" + i + ")";
    i++;
    if (i > 60) { name = base + " " + Date.now(); break; }
  }
  return name;
}

function classNameTaken_(ss, name) {
  const sh = ss.getSheetByName(SH_TEACHERS);
  if (!sh || sh.getLastRow() < 2) return false;
  const col = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues(); 
  const key = normKey_(name);
  for (let i = 0; i < col.length; i++) {
    if (col[i][0] && normKey_(col[i][0]) === key) return true;
  }
  return false;
}

function normKey_(v) {
  let s = String(v === null || v === undefined ? "" : v);
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");            
  s = s.replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  s = s.replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  s = s.replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ة/g, "ه");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
}

function clean_(v, maxLen) {
  const s = String(v === null || v === undefined ? "" : v).trim();
  if (s.length > (maxLen || MAX_LEN)) throw fail_("TOO_LONG", "أحد الحقول أطول من المسموح.");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s)) throw fail_("BAD_CHARS", "محارف غير مسموحة.");
  return s;
}

function req_(v, label) {
  const s = clean_(v);
  if (!s) throw fail_("REQUIRED", label + " مطلوب.");
  return s;
}

function validClassName_(v) {
  const n = req_(v, "اسم الصف");
  if (n.length > 90 || /[:\\\/\?\*\[\]]/.test(n)) throw fail_("BAD_NAME", "اسم الصف يحتوي رموزاً غير مسموحة.");
  if (SYSTEM_SHEETS.indexOf(n) !== -1) throw fail_("RESERVED", "هذا الاسم محجوز للنظام.");
  return n;
}

function isoDate_(v) {
  const s = clean_(v, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw fail_("BAD_DATE", "صيغة التاريخ يجب أن تكون yyyy-MM-dd.");
  const y = +m[1], mo = +m[2], d = +m[3];
  const p = new Date(Date.UTC(y, mo - 1, d));
  if (p.getUTCFullYear() !== y || p.getUTCMonth() !== mo - 1 || p.getUTCDate() !== d) throw fail_("BAD_DATE", "تاريخ غير صالح.");
  return s;
}

function isoOf_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, CONFIG.TIMEZONE, "yyyy-MM-dd");
  const s = String(v === null || v === undefined ? "" : v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + "-" + pad2_(m[2]) + "-" + pad2_(m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);      
  if (m) return m[3] + "-" + pad2_(m[2]) + "-" + pad2_(m[1]);
  return s;
}

function pad2_(n) { return ("0" + n).slice(-2); }
function todayIso_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd"); }
function dayNameOf_(iso) {
  const p = iso.split("-");
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return DAYS_AR[d.getUTCDay()];
}
function fail_(code, message) { const e = new Error(message); e.code = code; return e; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/* ====================== تقارير PDF ومجلدات Drive (بدون تغيير) ====================== */

function setupDailyPdfTrigger() {
  const fn = "generateDailyAttendancePDFs";
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(fn).timeBased().atHour(CONFIG.PDF_HOUR).nearMinute(0).everyDays(1).inTimezone(CONFIG.TIMEZONE).create();
  return "تم الضبط بنجاح";
}

function generateDailyAttendancePDFs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return { created: 0, skipped: 0, errors: ["تشغيل آخر جارٍ"] };
  const summary = { created: 0, skipped: 0, errors: [] };
  try {
    const ss   = getSS_();
    const iso  = todayIso_();
    const day  = dayNameOf_(iso);
    const fileDate = iso.split("-").reverse().join("-");
    const monthName = "شهر " + Number(iso.substring(5, 7)) + " - " + iso.substring(0, 4);
    const pdfName   = "حضور وغياب " + day + " " + fileDate + ".pdf";
    const master = DriveApp.getFolderById(CONFIG.MASTER_FOLDER_ID);
    const month  = getOrCreateFolder_(master, monthName);
    const head   = letterheadDataUri_();
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      const sh   = sheets[i];
      const name = sh.getName();
      if (SYSTEM_SHEETS.indexOf(name) !== -1) { summary.skipped++; continue; }
      try {
        if (sh.getLastRow() < 2) { summary.skipped++; continue; }
        const header = sh.getRange(1, 1, 1, HEADERS.length).getValues();
        if (!looksLikeAttendance_(header)) { summary.skipped++; continue; }
        const rows = [];
        const tally = { "حاضر": 0, "غائب": 0, "مأذون": 0 };
        const groups = groupRows_(locateDateRows_(sh, iso));
        for (let g = 0; g < groups.length; g++) {
          const block = groups[g];
          const data = sh.getRange(block.start, 1, block.count, HEADERS.length).getValues();
          for (let r = 0; r < data.length; r++) {
            if (isoOf_(data[r][2]) !== iso) continue;
            const st = String(data[r][4]).trim();
            if (tally[st] !== undefined) tally[st]++;
            rows.push([data[r][0], data[r][1], printDate_(iso), data[r][3] || day, st]);
          }
        }
        if (!rows.length) { summary.skipped++; continue; }
        const folder = getOrCreateClassFolder_(month, sh);
        const html   = buildPdfHtml_(name, day, printDate_(iso), rows, tally, head);
        const pdf    = Utilities.newBlob(html, MimeType.HTML, "a.html").getAs(MimeType.PDF).setName(pdfName);
        const created = folder.createFile(pdf);
        const olds = folder.getFilesByName(pdfName);
        while (olds.hasNext()) { const f = olds.next(); if (f.getId() !== created.getId()) f.setTrashed(true); }
        summary.created++;
      } catch (e) {
        const msg = name + ": " + (e.message || e);
        summary.errors.push(msg);
      }
    }
    return summary;
  } finally { lock.releaseLock(); }
}

function looksLikeAttendance_(data) {
  if (!data || data.length < 1 || data[0].length < 5) return false;
  for (let i = 0; i < 5; i++) if (String(data[0][i]).trim() !== HEADERS[i]) return false;
  return true;
}
function printDate_(iso) { const p = iso.split("-"); return Number(p[2]) + "/" + Number(p[1]) + "/" + p[0]; }
function letterheadDataUri_() {
  try {
    const blob = DriveApp.getFileById(CONFIG.LETTERHEAD_FILE_ID).getBlob();
    const ct = String(blob.getContentType() || "");
    if (ct.indexOf("image/") !== 0) return "";
    return "data:" + ct + ";base64," + Utilities.base64Encode(blob.getBytes());
  } catch (e) { return ""; }
}
function buildPdfHtml_(className, day, dateStr, rows, tally, headSrc) {
  let body = "";
  for (let i = 0; i < rows.length; i++) {
    body += "<tr>";
    for (let j = 0; j < rows[i].length; j++) {
      const v = (rows[i][j] === "" || rows[i][j] == null) ? "-" : rows[i][j];
      let cls = "";
      if (j === 4) {
        const s = String(v).trim();
        if (s === "حاضر") cls = ' class="p"'; else if (s === "غائب") cls = ' class="a"'; else if (s === "مأذون") cls = ' class="e"';
      }
      body += "<td" + cls + ">" + esc_(v) + "</td>";
    }
    body += "</tr>";
  }
  const total = tally["حاضر"] + tally["غائب"] + tally["مأذون"];
  return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}body{position:relative;font-family:Arial,Tahoma,sans-serif;direction:rtl;color:#1f2933}.lh{position:absolute;top:6mm;left:8mm;right:8mm;z-index:0;line-height:0}.lh img{display:block;width:100%;height:auto}.cw{position:relative;z-index:1;padding:' + (headSrc ? '47mm' : '12mm') + ' 8mm 6mm}.hd{text-align:center;margin:0 0 6px;font-weight:bold;color:#2c3e50;font-size:13px}.sm{text-align:center;margin:0 0 10px;font-size:11px;color:#555}.sm b{color:#8E1F6E}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #7f8c8d;padding:3px 5px;text-align:center;font-size:12px;line-height:1.15;overflow-wrap:break-word}th{background:#8E1F6E;color:#fff;padding:5px;font-weight:bold}tbody tr:nth-child(even){background:#f7f9fa}.p{color:#188038;font-weight:bold}.a{color:#c62828;font-weight:bold}.e{color:#b8860b;font-weight:bold;background:#f4f4f4}.ft{text-align:center;margin-top:8px;font-size:10px;color:#7f8c8d}</style></head><body>' + (headSrc ? '<div class="lh"><img src="' + headSrc + '" alt=""/></div>' : '') + '<div class="cw"><div class="hd">سجل الحضور والغياب — ' + esc_(className) + ' — ' + esc_(day) + ' ' + esc_(dateStr) + '</div><div class="sm">العدد الكلي <b>' + total + '</b> · حاضر <b>' + tally["حاضر"] + '</b> · غائب <b>' + tally["غائب"] + '</b> · مأذون <b>' + tally["مأذون"] + '</b></div><table><thead><tr><th style="width:35%">اسم الطالب</th><th style="width:22%">الصف</th><th style="width:18%">التاريخ</th><th style="width:13%">اليوم</th><th style="width:12%">الحالة</th></tr></thead><tbody>' + body + '</tbody></table><div class="ft">تم التوليد آلياً — مدرسة وروضة غرس الحديثة</div></div></body></html>';
}
function esc_(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function folderKey_(monthId, sheetId) { return PROP_FOLDER_PREFIX + ":" + monthId + ":" + sheetId; }
function histKey_(sheetId)            { return PROP_HIST_PREFIX + ":" + sheetId; }
function rememberOldName_(sheetId, name) {
  const sid = String(sheetId || "").trim(), n = String(name || "").trim();
  if (!sid || !n) return;
  const list = oldNames_(sid);
  if (list.indexOf(n) === -1) list.unshift(n);
  PropertiesService.getScriptProperties().setProperty(histKey_(sid), JSON.stringify(list.slice(0, 20)));
}
function oldNames_(sheetId) {
  const raw = PropertiesService.getScriptProperties().getProperty(histKey_(sheetId));
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
function getOrCreateFolder_(parent, name) { const it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function markerOf_(folder) {
  const desc = String(folder.getDescription() || "");
  const lines = desc.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.indexOf(FOLDER_MARKER) === 0) return t.substring(FOLDER_MARKER.length).trim();
  }
  return "";
}
function setMarker_(folder, sheetId) {
  const keep = (folder.getDescription() || "").split(/\r?\n/).filter(function (l) { return l.trim().indexOf(FOLDER_MARKER) !== 0; });
  keep.push(FOLDER_MARKER + sheetId);
  folder.setDescription(keep.join("\n").trim());
}
function claimFolder_(monthFolder, folder, sheetId, name) {
  if (folder.getName() !== name) folder.setName(name);
  setMarker_(folder, sheetId);
  PropertiesService.getScriptProperties().setProperty(folderKey_(monthFolder.getId(), sheetId), folder.getId());
  return folder;
}
function resolveClassFolder_(monthFolder, sheetId, candidates, currentName) {
  const props = PropertiesService.getScriptProperties();
  const key   = folderKey_(monthFolder.getId(), sheetId);
  const saved = props.getProperty(key);
  if (saved) {
    try { const f = DriveApp.getFolderById(saved); if (!f.isTrashed() && insideOf_(f, monthFolder.getId())) return claimFolder_(monthFolder, f, sheetId, currentName); } catch (_) {}
    props.deleteProperty(key);
  }
  const it = monthFolder.getFolders();
  const byName = {};
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    if (markerOf_(f) === String(sheetId)) return claimFolder_(monthFolder, f, sheetId, currentName);
    if (!markerOf_(f)) byName[normKey_(f.getName())] = f;
  }
  for (let i = 0; i < candidates.length; i++) {
    const hit = byName[normKey_(candidates[i])];
    if (hit) return claimFolder_(monthFolder, hit, sheetId, currentName);
  }
  return null;
}
function insideOf_(folder, parentId) {
  const it = folder.getParents();
  while (it.hasNext()) { if (it.next().getId() === parentId) return true; }
  return false;
}
function getOrCreateClassFolder_(monthFolder, sheet) {
  const name = sheet.getName(), sid = String(sheet.getSheetId());
  const found = resolveClassFolder_(monthFolder, sid, [name].concat(oldNames_(sid)), name);
  if (found) return found;
  return claimFolder_(monthFolder, monthFolder.createFolder(name), sid, name);
}
function syncFoldersAfterRename_(sheetId, oldName, newName) {
  const master = DriveApp.getFolderById(CONFIG.MASTER_FOLDER_ID);
  const it = master.getFolders();
  const names = [oldName, newName].concat(oldNames_(sheetId));
  while (it.hasNext()) {
    const month = it.next();
    try { resolveClassFolder_(month, sheetId, names, newName); } catch (e) { }
  }
}

/** ينفّذ عدة عمليات معلّقة في اتصال واحد. هذا يقلّل زمن المزامنة على الشبكات
 * الضعيفة، مع إبقاء نتيجة مستقلة لكل عملية حتى لا تمنع عملية خاطئة ما بعدها. */
function opSyncBatch_(ss, data) {
  const operations = Array.isArray(data.operations) ? data.operations : [];
  if (!operations.length) return { results: [] };
  if (operations.length > MAX_BATCH) throw fail_("TOO_MANY", "عدد عمليات المزامنة تجاوز الحد.");

  const cache = CacheService.getScriptCache();
  const results = [];
  for (let i = 0; i < operations.length; i++) {
    const op = operations[i] || {};
    const opId = clean_(op.opId || "", 160);
    const action = clean_(op.action || "", 40);

    if (!opId) {
      results.push({ ok: false, code: "REQUIRED", message: "رقم العملية مطلوب.", opId: "" });
      continue;
    }

    const hit = cache.get("OP_" + opId);
    if (hit) {
      try { results.push(JSON.parse(hit)); continue; } catch (_) {}
    }

    try {
      const value = Object.assign({ ok: true, opId: opId }, runWriteOperation_(ss, action, op));
      const payload = JSON.stringify(value);
      cache.put("OP_" + opId, payload, 21600);
      results.push(value);
    } catch (err) {
      results.push({
        ok: false,
        opId: opId,
        code: (err && err.code) || "ERROR",
        message: (err && err.message) || "تعذّر تنفيذ العملية."
      });
    }
  }
  return { results: results };
}

function runWriteOperation_(ss, action, data) {
  switch (action) {
    case "save_attendance": return opSaveAttendance_(ss, data);
    case "add_student":     return opAddStudent_(ss, data);
    case "rename_student":  return opRenameStudent_(ss, data);
    case "delete_student":  return opDeleteStudent_(ss, data);
    case "rename_teacher":  return opRenameTeacher_(ss, data);
    case "rename_class":    return opRenameClass_(ss, data);
    default: throw fail_("UNKNOWN_ACTION", "عملية غير معروفة.");
  }
}

/**
 * حضور الصفوف المختلفة يعمل بالتوازي. العملية الثانية للمعلمة نفسها تنتظر
 * حتى تنتهي الأولى، بينما تعديلات القائمة المشتركة تبقى حصرية على النظام كله.
 */
function acquireWriteGuard_(action, data) {
  const attendanceOnly = isAttendanceOnly_(action, data);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return null;

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();

  if (!attendanceOnly) {
    if (hasActiveAttendanceLease_(props, now)) {
      lock.releaseLock();
      return null;
    }
    return { mode: "global", lock: lock };
  }

  const scopes = attendanceTeacherScopes_(action, data);
  if (!scopes.length) return { mode: "global", lock: lock };

  for (let i = 0; i < scopes.length; i++) {
    const raw = props.getProperty(scopes[i]);
    if (raw && leaseExpiry_(raw) > now) {
      lock.releaseLock();
      return null;
    }
  }

  const token = now.toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  const value = token + "|" + (now + WRITE_LEASE_MS);
  for (let i = 0; i < scopes.length; i++) props.setProperty(scopes[i], value);
  lock.releaseLock();
  return { mode: "attendance", scopes: scopes, token: token };
}

function releaseWriteGuard_(guard) {
  if (!guard) return;
  if (guard.mode === "global") {
    guard.lock.releaseLock();
    return;
  }
  if (guard.mode !== "attendance" || !guard.scopes || !guard.scopes.length) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_MS)) return; // ينتهي الحجز تلقائيًا بعد مدة قصيرة.
  try {
    const props = PropertiesService.getScriptProperties();
    for (let i = 0; i < guard.scopes.length; i++) {
      const raw = props.getProperty(guard.scopes[i]) || "";
      if (raw.indexOf(guard.token + "|") === 0) props.deleteProperty(guard.scopes[i]);
    }
  } finally {
    lock.releaseLock();
  }
}

function isAttendanceOnly_(action, data) {
  if (action === "save_attendance") return true;
  if (action !== "sync_batch") return false;
  const operations = Array.isArray(data && data.operations) ? data.operations : [];
  return operations.length > 0 && operations.every(function (op) {
    return op && op.action === "save_attendance";
  });
}

function attendanceTeacherScopes_(action, data) {
  const operations = action === "sync_batch" && Array.isArray(data && data.operations)
    ? data.operations
    : [data || {}];
  const seen = {};
  const scopes = [];
  for (let i = 0; i < operations.length; i++) {
    const id = normKey_(operations[i] && operations[i].teacherId);
    if (!id) continue;
    const key = WRITE_LEASE_PREFIX + ":" + id;
    if (!seen[key]) { seen[key] = true; scopes.push(key); }
  }
  return scopes.sort();
}

function leaseExpiry_(raw) {
  const pos = String(raw || "").lastIndexOf("|");
  return pos === -1 ? 0 : Number(String(raw).slice(pos + 1)) || 0;
}

function hasActiveAttendanceLease_(props, now) {
  const all = props.getProperties();
  const prefix = WRITE_LEASE_PREFIX + ":";
  const keys = Object.keys(all);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(prefix) !== 0) continue;
    if (leaseExpiry_(all[keys[i]]) > now) return true;
    props.deleteProperty(keys[i]);
  }
  return false;
}
