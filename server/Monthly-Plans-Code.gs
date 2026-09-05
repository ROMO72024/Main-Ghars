// 1. الإعدادات الأساسية والثوابت
// ==========================================
var MASTER_TEMPLATE_ID = '1ktptKnfF_sIt6qBpTgLdG2qfB70JPiFPB9dT-HzyZiY'; 

var GRADE_DOCS = {
  'البستان': '1afd_hQ5xh-Njt1X5hxjgAsnLtC5qAWr6haUPKdVcf_c', 
  'التمهيدي': '1tJMiIVjKVKM8PgbjZLFD9vWLG03ubznPXtdi9Rahu5c',
  'الصف الأول': '1c-E9qrZaYYCg5R8MBxTx77r1kca5mvEny1G-Li38Ens',
  'الصف الثاني': '11Zg0XVqqmKHjzlv7IoxHlGvTO5PKwIIRzAAVAzm2cXM',
  'الصف الثالث': '1BFDOOHS_vPniKDkQR0crdFZUF9REh67AZ4vFq6i9aYU', 
  'الصف الرابع': '1xlcOvnCAXm02qdOUIas64ObYjaO0LrObWNlHPH2jGUY'
};

var SUBJECTS = ["الرياضيات", "اللغة العربية", "اللغة الإنجليزية", "العلوم", "القاعدة النورانية", "القيم والأخلاق", "الفن التشكيلي", "المبتكر الصغير", "المبرمج الصغير", "طبيب غرس", "شيف غرس", "الدبكة الشعبية", "اللياقة البدنية", "فن الإلقاء", "المسرح", "فن الاتيكيت", "التفريغ النفسي", "القرآن الكريم"];
var WEEKS = ["الأسبوع الأول", "الأسبوع الثاني", "الأسبوع الثالث", "الأسبوع الرابع"];
var PLAN_TIMEZONE = "Asia/Gaza";
var PLAN_MATCHING_VERSION = "2026-08-30.3";
// تحديث الواجهة فقط؛ إصدار فحص n8n يبقى كما هو حتى لا يلزم تعديل عقده مجددًا.
var PLAN_UI_VERSION = "2026-09-01.4-ui5";
// إصدار عرض مستقل؛ لا يغيّر حارس إصدار الفحص الموجود في n8n.
var PLAN_REPORT_VERSION = "2026-09-01.1-report2";
// حماية حفظ الخطط: منع الفراغ، ومنع التحديث دون تأكيد مؤقت مرتبط بالمحتوى.
var PLAN_ACTIVITY_MAX_LENGTH = 45000;
var PLAN_UPDATE_CONFIRMATION_TTL_SECONDS = 600;
var PLAN_UPDATE_CACHE_PREFIX = "GHARS_PLAN_UPDATE_V1:";
// مفاتيح الحماية لا تُكتب داخل الكود؛ تُنشأ مرة واحدة في Script Properties.
var GHARS_UI_ACCESS_PROPERTY = "GHARS_UI_ACCESS_KEY";
var GHARS_API_ACCESS_PROPERTY = "GHARS_API_KEY";
var GHARS_SECURITY_MIN_KEY_LENGTH = 40;

// مرجع واحد للفحص والحفظ والتعبئة، لجميع المراحل والأشهر.
// بقية المواد مطلوبة في الأسابيع الأربعة ما لم تكن مستثناة للصف.
var SUBJECT_WEEKS = {
  "المسرح": ["الأسبوع الأول", "الأسبوع الثالث"],
  "فن الاتيكيت": ["الأسبوع الثاني", "الأسبوع الرابع"],
  "المبتكر الصغير": ["الأسبوع الأول", "الأسبوع الثالث"],
  "شيف غرس": ["الأسبوع الأول", "الأسبوع الثالث"],
  "المبرمج الصغير": ["الأسبوع الثاني", "الأسبوع الرابع"],
  "طبيب غرس": ["الأسبوع الثاني", "الأسبوع الرابع"]
};

function getWeeksForSubject_(subject) {
  return (SUBJECT_WEEKS[subject] || WEEKS).slice();
}

// وصف آلي للبرامج ذات الجدول الخاص، حتى تبقى رسائل الفحص موافقة للخريطة دائمًا.
function getRestrictedSubjectScheduleSummary_() {
  return Object.keys(SUBJECT_WEEKS).map(function(subject) {
    return subject + ": " + getWeeksForSubject_(subject).join(" و");
  }).join("؛ ");
}

function isPlanWeekRequired_(grade, subject, week) {
  return isSubjectEnabledForGrade_(grade, subject) && getWeeksForSubject_(subject).indexOf(week) !== -1;
}

// مرجع قوائم الواجهة، ويُمرر إليها تلقائيًا عند عرض Index.html.
function getPlanCatalog_() {
  return {
    version: PLAN_MATCHING_VERSION,
    uiVersion: PLAN_UI_VERSION,
    grades: Object.keys(GRADE_DOCS), subjects: SUBJECTS.slice(), weeks: WEEKS.slice(),
    subjectWeeks: JSON.parse(JSON.stringify(SUBJECT_WEEKS)),
    exclusionsByGrade: JSON.parse(JSON.stringify(EXCLUDED_SUBJECTS_BY_GRADE))
  };
}

function generateGharsSecurityKey_() {
  return Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
}

function getGharsSecurityKey_(propertyName) {
  return String(PropertiesService.getScriptProperties().getProperty(propertyName) || "").trim();
}

function constantTimeTextEquals_(left, right) {
  var leftDigest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(left || ""), Utilities.Charset.UTF_8);
  var rightDigest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(right || ""), Utilities.Charset.UTF_8);
  if (leftDigest.length !== rightDigest.length) return false;
  var difference = 0;
  for (var i = 0; i < leftDigest.length; i++) difference |= leftDigest[i] ^ rightDigest[i];
  return difference === 0;
}

function requireConfiguredSecurityKey_(propertyName) {
  var key = getGharsSecurityKey_(propertyName);
  if (key.length < GHARS_SECURITY_MIN_KEY_LENGTH) {
    throw new Error("حماية النظام غير مهيأة. شغّل setupGharsSecurity_ مرة واحدة من محرر Apps Script.");
  }
  return key;
}

function assertUiRequestAuthorized_(e) {
  var expected = requireConfiguredSecurityKey_(GHARS_UI_ACCESS_PROPERTY);
  var supplied = String(e && e.parameter ? e.parameter.accessKey || "" : "").trim();
  if (!constantTimeTextEquals_(expected, supplied)) throw new Error("رابط الدخول غير صالح أو انتهت صلاحيته.");
  return supplied;
}

function assertUiCallAuthorized_(data) {
  var expected = requireConfiguredSecurityKey_(GHARS_UI_ACCESS_PROPERTY);
  var supplied = String(data && data.accessToken || "").trim();
  if (!constantTimeTextEquals_(expected, supplied)) throw new Error("غير مصرح بتنفيذ هذا الطلب.");
}

function assertApiRequestAuthorized_(e) {
  var expected = requireConfiguredSecurityKey_(GHARS_API_ACCESS_PROPERTY);
  var supplied = String(e && e.parameter ? e.parameter.apiKey || "" : "").trim();
  if (!constantTimeTextEquals_(expected, supplied)) throw new Error("غير مصرح باستخدام واجهة API.");
}

function createAccessDeniedPage_(message) {
  var safeMessage = String(message || "تعذر فتح النظام.")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>الوصول غير مصرح</title></head>' +
    '<body style="font-family:Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px">' +
    '<main style="max-width:620px;margin:10vh auto;background:#fff;border-top:6px solid #a21b54;' +
    'border-radius:12px;padding:28px;box-shadow:0 10px 25px rgba(0,0,0,.08)">' +
    '<h2 style="color:#a21b54;margin-top:0">تعذر فتح بوابة الخطط</h2>' +
    '<p style="line-height:1.8">' + safeMessage + '</p>' +
    '<p style="line-height:1.8;color:#555">استخدم رابط الدخول المعتمد الصادر من إدارة غرس.</p>' +
    '</main></body></html>')
    .setTitle('الوصول غير مصرح')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * شغّلها يدويًا مرة واحدة من محرر Apps Script بعد حفظ الكود.
 * تنشئ مفتاحين منفصلين وتطبع رابط المعلمات ومفتاح n8n في سجل التنفيذ.
 */
function setupGharsSecurity() {
  setupGharsSecurity_();
  // لا نعيد المفاتيح من الدالة العامة حتى لا يستطيع عميل الويب قراءتها.
  return "تم إعداد الحماية. افتح سجل التنفيذ لنسخ رابط المعلمات ومفتاح n8n.";
}

function setupGharsSecurity_() {
  var props = PropertiesService.getScriptProperties();
  var uiKey = getGharsSecurityKey_(GHARS_UI_ACCESS_PROPERTY) || generateGharsSecurityKey_();
  var apiKey = getGharsSecurityKey_(GHARS_API_ACCESS_PROPERTY) || generateGharsSecurityKey_();
  props.setProperties((function() {
    var values = {};
    values[GHARS_UI_ACCESS_PROPERTY] = uiKey;
    values[GHARS_API_ACCESS_PROPERTY] = apiKey;
    return values;
  })(), false);

  var baseUrl = String(ScriptApp.getService().getUrl() || "").trim();
  var teacherUrl = baseUrl ? baseUrl + "?accessKey=" + encodeURIComponent(uiKey) : "";
  console.log("رابط المعلمات الآمن:\n" + teacherUrl);
  console.log("مفتاح n8n — أضفه باسم apiKey في روابط inspectPlans وprocessPlans:\n" + apiKey);
  return {teacherUrl: teacherUrl, apiKey: apiKey};
}

/** تدوير المفاتيح عند تسرب الرابط؛ يلغي الروابط القديمة فورًا. */
function rotateGharsSecurityKeys_() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(GHARS_UI_ACCESS_PROPERTY);
  props.deleteProperty(GHARS_API_ACCESS_PROPERTY);
  return setupGharsSecurity_();
}

// المواد غير المطلوبة لكل صف.
// بهذه الخريطة يبقى لدينا قالب مخفي واحد، ولا تُطلب أو تُعبأ هذه المواد للبستان.
var EXCLUDED_SUBJECTS_BY_GRADE = {
  'البستان': ["المبتكر الصغير", "المبرمج الصغير", "الدبكة الشعبية"]
};

function isSubjectEnabledForGrade_(grade, subject) {
  var excludedSubjects = EXCLUDED_SUBJECTS_BY_GRADE[grade] || [];
  return excludedSubjects.indexOf(subject) === -1;
}

function getSubjectsForGrade_(grade) {
  var result = [];
  for (var i = 0; i < SUBJECTS.length; i++) {
    if (isSubjectEnabledForGrade_(grade, SUBJECTS[i])) {
      result.push(SUBJECTS[i]);
    }
  }
  return result;
}

// 🌟 خريطة الأشهر
var MONTH_MAP = {
  "شهر 8": "أغسطس (شهر 8)",
  "شهر 9": "سبتمبر (شهر 9)",
  "شهر 10": "أكتوبر (شهر 10)",
  "شهر 11": "نوفمبر (شهر 11)",
  "شهر 12": "ديسمبر (شهر 12)",
  "شهر 1": "يناير (شهر 1)",
  "شهر 2": "فبراير (شهر 2)",
  "شهر 3": "مارس (شهر 3)",
  "شهر 4": "أبريل (شهر 4)",
  "شهر 5": "مايو (شهر 5)",
  "شهر 6": "يونيو (شهر 6)",
  "شهر 7": "يوليو (شهر 7)",
  "أغسطس (شهر 8)": "أغسطس (شهر 8)",
  "سبتمبر (شهر 9)": "سبتمبر (شهر 9)",
  "أكتوبر (شهر 10)": "أكتوبر (شهر 10)",
  "نوفمبر (شهر 11)": "نوفمبر (شهر 11)",
  "ديسمبر (شهر 12)": "ديسمبر (شهر 12)",
  "يناير (شهر 1)": "يناير (شهر 1)",
  "فبراير (شهر 2)": "فبراير (شهر 2)",
  "مارس (شهر 3)": "مارس (شهر 3)",
  "أبريل (شهر 4)": "أبريل (شهر 4)",
  "مايو (شهر 5)": "مايو (شهر 5)",
  "يونيو (شهر 6)": "يونيو (شهر 6)",
  "يوليو (شهر 7)": "يوليو (شهر 7)"
};

// ==========================================
// 2. القائمة العلوية
// ==========================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ نظام غرس الآلي')
      .addItem('🚀 1. تعبئة الخطط للشهر الحالي', 'promptAndUpdateSimple_')
      .addItem('🧹 2. تنظيف الأقواس الفارغة (للنشر)', 'cleanEmptyPlaceholders_')
      .addSeparator() 
      .addItem('🔄 3. تصفير الملفات (الطريقة الآمنة)', 'restoreFromMaster_')
      .addItem('🧪 اختبار التنسيق على صف واحد', 'testExactResetForOneGrade_')
      .addItem('🔎 تدقيق سلامة الشيت كاملًا دون تعديل', 'testPlanDataQuality_')
      .addItem('📋 ملخص اكتمال الخطط للشهر الحالي', 'testPlanSummaryCurrentMonth_')
      .addItem('🧩 فحص وسوم البرامج ذات الأسابيع المحددة', 'testCurriculumTemplate_')
      .addToUi();
}

// ==========================================
// 3. ربط الواجهة HTML و API الـ n8n
// ==========================================
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "inspectPlans") {
    try {
      assertApiRequestAuthorized_(e);
      return jsonResponse_(inspectPlansForAPI_(e.parameter));
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      return jsonResponse_({
        status: /مصرح|مهيأة/.test(String(error && error.message || error)) ? "unauthorized" : "error",
        auditVersion: PLAN_MATCHING_VERSION,
        reportMessage: /مصرح|مهيأة/.test(String(error && error.message || error))
          ? "❌ غير مصرح باستخدام واجهة فحص الخطط."
          : "❌ تعذر فحص الخطط: " + (error.message || error)
      });
    }
  }

  if (e && e.parameter && e.parameter.action === "processPlans") {
    var targetMonth = String(e.parameter.month || "").trim();
    var lock = LockService.getScriptLock();
    var acquired = false;

    try {
      assertApiRequestAuthorized_(e);
      if (!targetMonth || targetMonth === "undefined") {
        throw new Error("لم يتم تحديد الشهر بشكل صحيح من البوت.");
      }

      // منع استدعاءين من n8n من مسح الملفات وتعبئتها في الوقت نفسه.
      acquired = lock.tryLock(10000);
      if (!acquired) {
        throw new Error("هناك عملية تجهيز خطط تعمل الآن. أعد المحاولة بعد قليل.");
      }

      // لقطة واحدة للمصدر: التقرير والتعبئة يقرآن القيم نفسها في هذه العملية.
      var source = readPlanSource_();
      var audit = preflightPlanGeneration_(targetMonth, source);
      validateCurriculumTemplate_();
      advancedResetFromMaster_();
      updateMonthlyPlanForAPI_(targetMonth, source);
      cleanEmptyPlaceholdersAPI_();

      return jsonResponse_({
        status: "success",
        auditVersion: PLAN_MATCHING_VERSION,
        reportVersion: PLAN_REPORT_VERSION,
        month: audit.month,
        sourceSpreadsheetId: audit.sourceSpreadsheetId,
        sourceSheet: audit.sourceSheet,
        completedCount: audit.completedCount,
        missingCount: audit.missingCount,
        emptyCount: audit.emptyCount,
        notFoundCount: audit.notFoundCount,
        unverifiedCount: audit.unverifiedCount,
        gradeSummaries: audit.gradeSummaries,
        reportMessage: limitPlanReport_(audit.reportMessage + "\n\nتم تجهيز مستندات الخطط للشهر المطلوب بالقيم الموجودة في هذه اللقطة.")
      });
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      var unauthorized = /مصرح|مهيأة/.test(String(error && error.message || error));
      return jsonResponse_({
        status: unauthorized ? "unauthorized" : "error",
        auditVersion: PLAN_MATCHING_VERSION,
        reportMessage: unauthorized
          ? "❌ غير مصرح باستخدام واجهة تجهيز الخطط."
          : "❌ فشل تجهيز الخطط: " + (error.message || error)
      });
    } finally {
      if (acquired) lock.releaseLock();
    }
  }
  
  try {
    var uiAccessKey = assertUiRequestAuthorized_(e);
    return createPlanEntryPage_(uiAccessKey);
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return createAccessDeniedPage_(error && error.message ? error.message : error);
  }
}

/** يحتفظ بصفحة Index الحالية، ويضيف مزامنة لقوائمها دون تغيير ملف HTML. */
function createPlanEntryPage_(uiAccessKey) {
  var page = HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('مدرسة روضة غرس الحديثة')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // لا نُضمّن أنشطة الشيت أو مدخلات المستخدم داخل JavaScript.
  var catalogJson = JSON.stringify(getPlanCatalog_())
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  var bootstrapJson = JSON.stringify({uiAccessToken: String(uiAccessKey || "")})
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  page.append('\n<script id="ghars-plan-catalog-adapter">\n' +
    'window.__GHARS_APP_BOOTSTRAP__=' + bootstrapJson + ';\n(' +
    syncPlanEntryUiClient_.toString() + ')(' + catalogJson + ');\n</script>');
  return page;
}

/**
 * تعمل هذه الدالة داخل المتصفح فقط بعد تضمينها في الصفحة.
 * تتعرف على القوائم بمحتوى خياراتها، لا بأسماء عناصر HTML مجهولة.
 * لا تحفظ بيانات ولا ترسل طلبات ولا تمس تفاصيل النشاط أو تصميم الصفحة.
 */
function syncPlanEntryUiClient_(catalog) {
  if (window.__gharsPlanCatalogUi === catalog.uiVersion) return;
  window.__gharsPlanCatalogUi = catalog.uiVersion;
  var controls = {subject: null, grade: null, week: null};
  var optionCache = {subject: Object.create(null), week: Object.create(null)};
  var observer = null, pending = false, running = false;
  var notice = null;

  function norm(value) {
    return String(value || '').normalize('NFKC')
      .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
      .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ').trim();
  }

  function canonicalOption(option, names) {
    if (!option) return '';
    var label = norm(option.textContent), value = norm(option.value);
    for (var i = 0; i < names.length; i++) {
      if (norm(names[i]) === label || norm(names[i]) === value) return names[i];
    }
    return '';
  }

  function currentName(select, names) {
    return select ? canonicalOption(select.options[select.selectedIndex], names) : '';
  }

  function findControl(names, minimum, root) {
    var candidates = Array.prototype.slice.call(root.querySelectorAll('select')).filter(function(select) {
      return !select.multiple && select.getClientRects().length > 0;
    }).map(function(select) {
      var matches = Object.create(null);
      Array.prototype.forEach.call(select.options, function(option) {
        var name = canonicalOption(option, names);
        if (name) matches[name] = true;
      });
      return {select: select, score: Object.keys(matches).length};
    }).filter(function(item) { return item.score >= minimum; });
    candidates.sort(function(a, b) { return b.score - a.score; });
    if (!candidates.length || (candidates.length > 1 && candidates[0].score === candidates[1].score)) return null;
    return candidates[0].select;
  }

  function rememberOptions(select, names, cache) {
    Array.prototype.forEach.call(select.options, function(option) {
      var name = canonicalOption(option, names);
      if (name) cache[name] = option.cloneNode(true);
    });
  }

  function replaceOptions(select, names, allNames, cache, prompt) {
    rememberOptions(select, allNames, cache);
    var selected = currentName(select, allNames);
    var desired = [];
    var empty = Array.prototype.find.call(select.options, function(option) {
      return !option.value && !canonicalOption(option, allNames);
    });
    var placeholder = empty ? empty.cloneNode(true) : new Option(prompt, '');
    placeholder.selected = false;
    desired.push(placeholder);
    names.forEach(function(name) {
      var option = cache[name] ? cache[name].cloneNode(true) : new Option(name, name);
      option.textContent = name;
      option.selected = false;
      desired.push(option);
    });
    var signature = function(options) {
      return JSON.stringify(Array.prototype.map.call(options, function(option) {
        return [option.value, option.textContent, option.disabled, option.hidden];
      }));
    };
    if (signature(select.options) !== signature(desired)) {
      var fragment = document.createDocumentFragment();
      desired.forEach(function(option) { fragment.appendChild(option); });
      select.replaceChildren(fragment);
    }
    var selectedIndex = names.indexOf(selected);
    select.selectedIndex = selectedIndex < 0 ? 0 : selectedIndex + 1;
  }

  function showNotice(text, error) {
    if (!notice || !document.contains(notice)) {
      notice = document.createElement('div');
      notice.id = 'ghars-plan-catalog-status';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.dir = 'rtl';
      notice.style.cssText = 'font-size:12px;line-height:1.7;margin:8px 0;white-space:normal;';
      if (controls.subject && document.contains(controls.subject)) {
        controls.subject.insertAdjacentElement('afterend', notice);
      } else if (document.body) {
        document.body.prepend(notice);
      }
    }
    if (notice.textContent !== text) notice.textContent = text;
    notice.style.color = error ? '#9f1239' : '#166534';
    notice.setAttribute('data-ghars-ui-version', catalog.uiVersion);
  }

  function sync() {
    pending = false;
    if (running || !document.body) return;
    running = true;
    try {
      if (!controls.subject || !document.contains(controls.subject)) {
        controls.subject = findControl(catalog.subjects, 4, document);
        optionCache.subject = Object.create(null);
      }
      if (!controls.subject) {
        showNotice('تعذر تحديد قائمة المواد بأمان. يلزم مراجعة ملف Index.html؛ لم تتغير بياناتك.', true);
        return;
      }
      var root = controls.subject.form || document;
      if (!controls.grade || !root.contains(controls.grade)) controls.grade = findControl(catalog.grades, 2, root);
      if (!controls.week || !root.contains(controls.week)) {
        controls.week = findControl(catalog.weeks, 1, root);
        optionCache.week = Object.create(null);
      }
      var grade = currentName(controls.grade, catalog.grades);
      var excluded = catalog.exclusionsByGrade[grade] || [];
      var allowedSubjects = catalog.subjects.filter(function(subject) { return excluded.indexOf(subject) < 0; });
      replaceOptions(controls.subject, allowedSubjects, catalog.subjects, optionCache.subject, 'اختر المادة...');
      var subject = currentName(controls.subject, catalog.subjects);
      if (!controls.week) {
        showNotice('تم تحديث جدول أسابيع البرامج. تعذر تحديد قائمة الأسبوع؛ يلزم مراجعة Index.html.', true);
        return;
      }
      var allowedWeeks = catalog.subjectWeeks[subject] || catalog.weeks;
      replaceOptions(controls.week, allowedWeeks, catalog.weeks, optionCache.week, 'اختر الأسبوع...');
      showNotice(subject && catalog.subjectWeeks[subject]
        ? subject + ': ' + allowedWeeks.join(' و') + ' فقط.'
        : 'اختر المادة لتظهر الأسابيع المقررة لها حسب جدول البرامج.', false);
    } finally {
      running = false;
    }
  }

  function scheduleSync() {
    if (pending) return;
    pending = true;
    window.setTimeout(sync, 0);
  }

  function start() {
    // نراقب إعادة إنشاء الخيارات بواسطة كود الواجهة القديم، دون حلقة استطلاع مستمرة.
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, {childList: true, subtree: true});
    document.addEventListener('change', function(event) {
      if (event.target === controls.subject || event.target === controls.grade || event.target === controls.week) scheduleSync();
    });
    document.addEventListener('reset', scheduleSync);
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 4. حفظ البيانات من الواجهة إلى الشيت
// ==========================================
function normalizePlanEntryIdentity_(data) {
  if (!data || typeof data !== "object") {
    throw new Error("بيانات الخطة غير موجودة.");
  }

  var monthInput = String(data.month === null || data.month === undefined ? "" : data.month).trim();
  if (!monthInput) {
    throw new Error("يجب تحديد الشهر.");
  }

  var grade = resolvePlanGrade_(data.grade, true);
  var subject = resolvePlanSubject_(data.subject, true);
  var week = resolvePlanWeek_(data.week, true);
  if (!grade || !subject || !week) {
    throw new Error("يجب تحديد الصف والمادة والأسبوع.");
  }
  if (!isSubjectEnabledForGrade_(grade, subject)) {
    throw new Error("المادة (" + subject + ") غير مطلوبة لصف " + grade + ".");
  }
  if (!isPlanWeekRequired_(grade, subject, week)) {
    throw new Error("مادة " + subject + " مطلوبة فقط في " +
      getWeeksForSubject_(subject).join(" و") +
      " للصفوف التي تُطلب فيها هذه المادة.");
  }

  return {
    month: normalizePlanMonthForQuery_(monthInput),
    grade: grade,
    subject: subject,
    week: week
  };
}

function normalizePlanEntryInput_(data) {
  var identity = normalizePlanEntryIdentity_(data);
  var activity = String(data.activity === null || data.activity === undefined ? "" : data.activity)
    .replace(/\r\n?/g, "\n").trim();
  var visibleActivity = activity
    .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .trim();
  if (!visibleActivity) {
    throw new Error("تفاصيل الأنشطة مطلوبة، ولا يمكن حفظ خطة فارغة.");
  }
  if (activity.length > PLAN_ACTIVITY_MAX_LENGTH) {
    throw new Error("تفاصيل الأنشطة طويلة جدًا. الحد الأقصى " + PLAN_ACTIVITY_MAX_LENGTH + " حرفًا.");
  }

  identity.activity = activity;
  return identity;
}

function makePlanEntryKey_(entry) {
  return [entry.month, entry.grade, entry.subject, entry.week].join("\u001F");
}

function findStoredPlanEntry_(source, entry) {
  var matches = [];
  for (var r = 1; r < source.data.length; r++) {
    var identity = readStoredPlanIdentity_(source.data[r], source.columns);
    if (identity.month === entry.month &&
        identity.grade === entry.grade &&
        identity.subject === entry.subject &&
        identity.week === entry.week) {
      matches.push({
        row: r + 1,
        activity: String(source.data[r][source.columns.activity] || "").trim()
      });
    }
  }

  var selected = matches.length ? matches[matches.length - 1] : null;
  return {
    exists: !!selected,
    targetRow: selected ? selected.row : -1,
    currentActivity: selected ? selected.activity : "",
    duplicateCount: Math.max(0, matches.length - 1)
  };
}

function hashPlanEntryValue_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value === null || value === undefined ? "" : value),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
}

function issuePlanUpdateConfirmation_(entry, match) {
  var token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  var payload = {
    keyHash: hashPlanEntryValue_(makePlanEntryKey_(entry)),
    oldActivityHash: hashPlanEntryValue_(match.currentActivity),
    newActivityHash: hashPlanEntryValue_(entry.activity),
    issuedAt: Date.now()
  };
  CacheService.getScriptCache().put(
    PLAN_UPDATE_CACHE_PREFIX + token,
    JSON.stringify(payload),
    PLAN_UPDATE_CONFIRMATION_TTL_SECONDS
  );
  return token;
}

function planEntryIdentityForClient_(entry) {
  return {
    month: entry.month,
    grade: entry.grade,
    subject: entry.subject,
    week: entry.week
  };
}

function buildPlanExistsResponse_(entry, match, status, message) {
  return {
    ok: true,
    status: status || "exists",
    message: message || "هذه الخطة معبأة مسبقًا. راجعي المحتوى قبل تأكيد التحديث.",
    identity: planEntryIdentityForClient_(entry),
    existingActivity: match.currentActivity,
    newActivity: entry.activity,
    confirmationToken: issuePlanUpdateConfirmation_(entry, match),
    confirmationExpiresInSeconds: PLAN_UPDATE_CONFIRMATION_TTL_SECONDS,
    duplicateCount: match.duplicateCount
  };
}

function planEntryErrorResponse_(error) {
  console.error(error && error.stack ? error.stack : error);
  return {
    ok: false,
    status: "error",
    message: "❌ " + (error && error.message ? error.message : error)
  };
}

/** فحص قراءة فقط. لا ينشئ صفًا ولا يغيّر أي خلية. */
function checkPlanEntry(data) {
  try {
    assertUiCallAuthorized_(data);
    var entry = normalizePlanEntryInput_(data);
    var source = readPlanSource_();
    var match = findStoredPlanEntry_(source, entry);
    if (match.exists) {
      return buildPlanExistsResponse_(entry, match);
    }

    return {
      ok: true,
      status: "new",
      message: "الخطة جديدة وجاهزة للحفظ.",
      identity: planEntryIdentityForClient_(entry)
    };
  } catch (error) {
    return planEntryErrorResponse_(error);
  }
}

/**
 * يعرض الخطة المخزنة للمراجعة فقط وفق الشهر والصف والمادة والأسبوع.
 * لا ينشئ صفًا، ولا يصدر رمز تحديث، ولا يغيّر أي خلية.
 */
function getPlanForReview(data) {
  try {
    assertUiCallAuthorized_(data);
    var entry = normalizePlanEntryIdentity_(data);
    var source = readPlanSource_();
    var match = findStoredPlanEntry_(source, entry);
    if (!match.exists) {
      return {
        ok: true,
        status: "not_found",
        message: "لم يتم العثور على خطة محفوظة لهذا الاختيار.",
        identity: planEntryIdentityForClient_(entry),
        duplicateCount: 0
      };
    }

    return {
      ok: true,
      status: "found",
      message: match.currentActivity
        ? "تم العثور على الخطة المحفوظة في Google Sheets."
        : "السجل موجود، لكن تفاصيل الأنشطة فيه فارغة.",
      identity: planEntryIdentityForClient_(entry),
      existingActivity: match.currentActivity,
      sourceRow: match.targetRow,
      duplicateCount: match.duplicateCount
    };
  } catch (error) {
    return planEntryErrorResponse_(error);
  }
}

/**
 * ملخص قراءة فقط لنواقص برنامج واحد في شهر واحد عبر جميع الصفوف.
 * يتجاهل الصف والأسبوع المحددين في الواجهة، ويحتسب فقط الأسابيع المقررة للبرنامج.
 */
function getMissingPlansForProgram(data) {
  try {
    assertUiCallAuthorized_(data);
    var monthInput = String(data && data.month || "").trim();
    if (!monthInput) throw new Error("يجب تحديد الشهر أولًا.");
    var subject = resolvePlanSubject_(data && data.subject, true);
    if (!subject) throw new Error("يجب تحديد المادة أو البرنامج أولًا.");

    var month = normalizePlanMonthForQuery_(monthInput);
    var source = readPlanSource_();
    var filled = {};

    for (var r = 1; r < source.data.length; r++) {
      var row = source.data[r];
      var identity;
      try {
        identity = readStoredPlanIdentity_(row, source.columns);
      } catch (invalidStoredRowError) {
        // صف قديم غير صالح لا ينبغي أن يعطّل تقرير النواقص كاملًا.
        continue;
      }
      if (identity.month !== month || identity.subject !== subject ||
          !identity.grade || !identity.week ||
          !isPlanWeekRequired_(identity.grade, identity.subject, identity.week)) {
        continue;
      }
      if (hasPlanActivity_(row[source.columns.activity])) {
        filled[makePlanKey_(identity.grade, identity.subject, identity.week)] = true;
      }
    }

    var missingByGrade = [];
    var totalExpected = 0;
    var completedCount = 0;
    var grades = Object.keys(GRADE_DOCS);
    for (var g = 0; g < grades.length; g++) {
      var grade = grades[g];
      if (!isSubjectEnabledForGrade_(grade, subject)) continue;
      var scheduledWeeks = getWeeksForSubject_(subject);
      var missingWeeks = [];
      for (var w = 0; w < scheduledWeeks.length; w++) {
        var week = scheduledWeeks[w];
        totalExpected++;
        if (filled[makePlanKey_(grade, subject, week)]) completedCount++;
        else missingWeeks.push(week);
      }
      if (missingWeeks.length) {
        missingByGrade.push({grade: grade, weeks: missingWeeks});
      }
    }

    var missingCount = totalExpected - completedCount;
    return {
      ok: true,
      status: "success",
      month: month,
      subject: subject,
      scheduledWeeks: getWeeksForSubject_(subject),
      totalExpected: totalExpected,
      completedCount: completedCount,
      missingCount: missingCount,
      allComplete: missingCount === 0,
      missingByGrade: missingByGrade,
      message: missingCount === 0
        ? "✅ جميع خطط " + subject + " مكتملة في " + month + "."
        : "توجد " + missingCount + " خطة غير مدرجة من أصل " + totalExpected +
          " لخطة " + subject + " في " + month + "."
    };
  } catch (error) {
    return planEntryErrorResponse_(error);
  }
}

function safePlanActivityForSheet_(activity) {
  // يمنع تفسير النشاط كمعادلة إذا بدأ بعلامة =، مع بقائه ظاهرًا كنص طبيعي.
  return activity.charAt(0) === "=" ? "'" + activity : activity;
}

function writeCanonicalPlanEntry_(sheet, headers, targetRow, entry) {
  var monthCol = headers.indexOf("الشهر");
  var gradeCol = headers.indexOf("الصف");
  var subjectCol = headers.indexOf("المادة");
  var weekCol = headers.indexOf("الأسبوع");
  var activityCol = headers.indexOf("تفاصيل الأنشطة");
  sheet.getRange(targetRow, monthCol + 1).setValue(entry.month);
  sheet.getRange(targetRow, gradeCol + 1).setValue(entry.grade);
  sheet.getRange(targetRow, subjectCol + 1).setValue(entry.subject);
  sheet.getRange(targetRow, weekCol + 1).setValue(entry.week);
  sheet.getRange(targetRow, activityCol + 1)
    .setNumberFormat("@")
    .setValue(safePlanActivityForSheet_(entry.activity));
}

/**
 * ينشئ خطة جديدة، أو يحدّث خطة موجودة فقط بتأكيد صالح صادر من checkPlanEntry.
 * يُعاد فحص الشيت داخل القفل لمنع التكرار والتحديث فوق تعديل أحدث.
 */
function addData(data) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    assertUiCallAuthorized_(data);
    var entry = normalizePlanEntryInput_(data);
    acquired = lock.tryLock(15000);
    if (!acquired) {
      return {ok: false, status: "busy",
        message: "⏳ توجد عملية حفظ أخرى الآن. انتظري لحظات ثم أعيدي المحاولة."};
    }

    var source = readPlanSource_();
    var sheet = source.sheet;
    var headers = source.headers;
    validateRequiredColumns_(headers);
    var match = findStoredPlanEntry_(source, entry);
    var wantsUpdate = data.confirmUpdate === true;

    if (!match.exists) {
      if (wantsUpdate) {
        throw new Error("الخطة التي طُلب تحديثها لم تعد موجودة. أغلقي النافذة وأعيدي الحفظ.");
      }
      var newRow = new Array(headers.length).fill("");
      newRow[headers.indexOf("الشهر")] = entry.month;
      newRow[headers.indexOf("الصف")] = entry.grade;
      newRow[headers.indexOf("المادة")] = entry.subject;
      newRow[headers.indexOf("الأسبوع")] = entry.week;
      newRow[headers.indexOf("تفاصيل الأنشطة")] = safePlanActivityForSheet_(entry.activity);
      sheet.appendRow(newRow);
      return {
        ok: true,
        status: "created",
        message: "✅ تم إنشاء الخطة الجديدة بنجاح.",
        identity: planEntryIdentityForClient_(entry)
      };
    }

    // حتى لو تجاوز عميل قديم خطوة الفحص، لا نحدّث الخطة الموجودة دون تأكيد.
    if (!wantsUpdate) {
      return buildPlanExistsResponse_(entry, match);
    }

    var token = String(data.confirmationToken || "").trim();
    if (!token) {
      throw new Error("لم يتم تحديث الخطة: يلزم تأكيد التعديل من نافذة المراجعة.");
    }
    var cache = CacheService.getScriptCache();
    var cachedText = cache.get(PLAN_UPDATE_CACHE_PREFIX + token);
    if (!cachedText) {
      throw new Error("انتهت صلاحية تأكيد التحديث. أغلقي النافذة وأعيدي المحاولة لعرض أحدث خطة.");
    }
    var confirmation = JSON.parse(cachedText);
    var sameKey = confirmation.keyHash === hashPlanEntryValue_(makePlanEntryKey_(entry));
    var sameNewActivity = confirmation.newActivityHash === hashPlanEntryValue_(entry.activity);
    if (!sameKey || !sameNewActivity) {
      throw new Error("بيانات الخطة تغيرت بعد فتح نافذة التأكيد. أغلقي النافذة وأعيدي الحفظ.");
    }

    if (confirmation.oldActivityHash !== hashPlanEntryValue_(match.currentActivity)) {
      cache.remove(PLAN_UPDATE_CACHE_PREFIX + token);
      return buildPlanExistsResponse_(entry, match, "stale",
        "تم تعديل الخطة من مستخدم آخر أثناء المراجعة. هذه أحدث نسخة؛ راجعيها ثم أكدي مجددًا.");
    }

    writeCanonicalPlanEntry_(sheet, headers, match.targetRow, entry);
    cache.remove(PLAN_UPDATE_CACHE_PREFIX + token);
    return {
      ok: true,
      status: "updated",
      message: "✅ تم تحديث الخطة الموجودة بنجاح بعد التأكيد.",
      identity: planEntryIdentityForClient_(entry),
      duplicateCount: match.duplicateCount
    };
  } catch (error) {
    return planEntryErrorResponse_(error);
  } finally {
    if (acquired) lock.releaseLock();
  }
}

// ==========================================
// 5. العمليات اليدوية (من القائمة العلوية)
// ==========================================
function promptAndUpdateSimple_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('تعبئة الخطط', 'اكتب الشهر لتعبئته (مثال: شهر 8 أو أغسطس):', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() == ui.Button.OK) {
    var targetMonth = response.getResponseText().trim();
    if (targetMonth !== "") updateMonthlyPlan_(targetMonth);
  }
}

function updateMonthlyPlan_(targetMonth) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var source = readPlanSource_();
    preflightPlanGeneration_(targetMonth, source);
    validateCurriculumTemplate_();
    advancedResetFromMaster_();
    updateMonthlyPlanForAPI_(targetMonth, source);
    SpreadsheetApp.getUi().alert("🎉 اكتملت العملية! تمت تعبئة الخطط لـ (" + targetMonth + ").");
  } finally {
    lock.releaseLock();
  }
}

function restoreFromMaster_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert(
    "تصفير ملفات الخطط",
    "سيتم مسح محتوى ملفات الصفوف الستة وإعادتها من القالب المخفي مع إبقاء الروابط نفسها. هل تريد المتابعة؟",
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    advancedResetFromMaster_();
    ui.alert("✅ تمت إعادة جميع الملفات من القالب مع الحفاظ على روابطها.");
  } catch (error) {
    ui.alert("❌ فشل التصفير:\n" + (error.message || error));
    throw error;
  }
}

/**
 * اختبار آمن نسبياً على ملف صف واحد قبل تشغيل التصفير على الملفات الستة.
 * اكتب اسم الصف كما هو موجود في GRADE_DOCS، مثل: البستان
 */
function testExactResetForOneGrade_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    "اختبار التنسيق",
    "اكتب اسم صف واحد بالضبط (مثال: البستان أو الصف الأول):",
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  var grade = response.getResponseText().trim();
  if (!GRADE_DOCS.hasOwnProperty(grade)) {
    ui.alert("❌ اسم الصف غير موجود في GRADE_DOCS: " + grade);
    return;
  }

  try {
    var masterDoc = DocumentApp.openById(MASTER_TEMPLATE_ID);
    var masterParts = getPrimaryDocumentParts_(masterDoc);
    var masterNamedStyles = loadMasterNamedStyles_();

    validateTopLevelElements_(masterParts.body, "جسم القالب");
    if (masterParts.header) validateTopLevelElements_(masterParts.header, "رأس القالب");
    if (masterParts.footer) validateTopLevelElements_(masterParts.footer, "تذييل القالب");

    resetOneGradeFromMaster_(grade, masterParts, masterNamedStyles);
    ui.alert("✅ تم اختبار النسخ على ملف: " + grade + "\nافتح الملف وافحص التنسيق قبل تشغيل بقية الملفات.");
  } catch (error) {
    ui.alert("❌ فشل الاختبار:\n" + (error.message || error));
    throw error;
  }
}

function cleanEmptyPlaceholders_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('تنظيف الملفات', 'سيتم مسح الأقواس الفارغة. هل أنت متأكد؟', ui.ButtonSet.YES_NO);
  if (response == ui.Button.YES) {
    cleanEmptyPlaceholdersAPI_();
    ui.alert('🧹 تم التنظيف بنجاح وجاهز للنشر!');
  }
}

// ==========================================
// 6. العمليات الآلية الخاصة بـ n8n (المسح الذري)
// ==========================================

function atomicScan_(targetMonth) {
  // نفس محرك فحص واتساب؛ وجود صف فارغ لا يعني أن الأسبوع معبأ.
  var result = inspectPlansForAPI_({ month: targetMonth, mode: "missing" });
  return result.reportMessage;
}

// ==========================================
// 6.1 الاستعلام الذكي عن الخطط من واتساب
// ==========================================

/**
 * فحص للقراءة فقط؛ لا يصفّر المستندات ولا ينشئ PDF ولا يغيّر أي خلية.
 * mode=missing يعرض البرامج المكتملة ومراجعة الأسابيع، مجمّعة حسب المرحلة.
 * mode=content يعرض محتوى الخطط المطابقة للسؤال.
 * mode=audit يدقق هويات صفوف الشيت كله، دون احتساب نواقص شهر محدد.
 */
function inspectPlansForAPI_(params, sourceSnapshot) {
  params = params || {};

  var mode = String(params.mode || "missing").trim().toLowerCase();
  if (["content", "missing", "audit"].indexOf(mode) === -1) mode = "missing";

  var source = sourceSnapshot || readPlanSource_();
  // سلامة الأسماء والهوية لا تتقيد بفلتر السؤال؛ تكشف مثلاً «علاء» في البستان
  // حتى عندما يكون سؤال المستخدم عن شيف غرس للتمهيدي.
  var dataQuality = inspectPlanDataQuality_(source);
  if (mode === "audit") return buildPlanDataQualityResult_(source, dataQuality);

  var targetMonthFull = normalizePlanMonthForQuery_(params.month);
  var gradeFilter = resolvePlanGrade_(params.grade);
  var subjectFilter = resolvePlanSubject_(params.subject);
  var weekFilter = resolvePlanWeek_(params.week);
  validatePlanQuestionSubject_(params.original_question, subjectFilter);

  var filters = buildPlanFilters_(gradeFilter, subjectFilter, weekFilter);
  var collection = collectPlanRows_(source, targetMonthFull, filters);

  var expected = {};
  var expectedOrder = [];

  for (var grade in GRADE_DOCS) {
    if (gradeFilter && grade !== gradeFilter) continue;

    var gradeSubjects = getSubjectsForGrade_(grade);
    for (var s = 0; s < gradeSubjects.length; s++) {
      var subject = gradeSubjects[s];
      if (subjectFilter && subject !== subjectFilter) continue;

      var subjectWeeks = getWeeksForSubject_(subject);
      for (var w = 0; w < subjectWeeks.length; w++) {
        var week = subjectWeeks[w];
        if (weekFilter && week !== weekFilter) continue;

        var key = makePlanKey_(grade, subject, week);
        var descriptor = {
          grade: grade,
          subject: subject,
          week: week
        };
        expected[key] = descriptor;
        expectedOrder.push(key);
      }
    }
  }

  if (expectedOrder.length === 0) {
    var excludedMessage = "ℹ️ لا توجد خطة مطلوبة لهذا الاختيار";
    if (gradeFilter && subjectFilter &&
        !isSubjectEnabledForGrade_(gradeFilter, subjectFilter)) {
      excludedMessage = "ℹ️ مادة " + subjectFilter +
        " غير مطلوبة لصف " + gradeFilter + " حسب إعدادات النظام.";
    } else if (subjectFilter && weekFilter &&
        getWeeksForSubject_(subjectFilter).indexOf(weekFilter) === -1) {
      excludedMessage = "ℹ️ " + subjectFilter + " غير مقرر في " + weekFilter +
        ". موعده فقط: " + getWeeksForSubject_(subjectFilter).join(" و") +
        " للصفوف التي يُطلب فيها. هذا ليس نقص تعبئة.";
    }

    var noExpectedResult = {
      status: dataQuality.errorCount ? "partial" : "success",
      mode: mode,
      month: targetMonthFull,
      filters: buildPlanFilters_(gradeFilter, subjectFilter, weekFilter),
      totalExpected: 0,
      completedCount: 0,
      missingCount: 0,
      emptyCount: 0,
      notFoundCount: 0,
      unverifiedCount: 0,
      isComplete: true,
      missing: [],
      unverified: [],
      evidence: [],
      records: [],
      auditVersion: PLAN_MATCHING_VERSION,
      reportVersion: PLAN_REPORT_VERSION,
      gradeSummaries: [],
      sourceSheet: source.sheet.getName(),
      sourceSpreadsheetId: source.spreadsheetId,
      sourceSpreadsheetName: source.spreadsheetName,
      sourceUrl: source.url,
      checkedAt: source.checkedAt,
      diagnostics: collection.diagnostics,
      dataQuality: dataQuality,
      notRequiredMessage: excludedMessage,
      reportMessage: ""
    };
    noExpectedResult.reportMessage = buildPlanMissingReport_(noExpectedResult);
    return noExpectedResult;
  }

  // الفحص والتعبئة يعتمدان الهوية نفسها، مع إبقاء الشيف والطبيب منفصلين.
  var filledByKey = collection.filledByKey;

  var missing = [];
  var records = [];
  var evidence = [];
  var unverified = [];
  for (var i = 0; i < expectedOrder.length; i++) {
    var expectedKey = expectedOrder[i];
    var descriptor = expected[expectedKey];
    var rowNumbers = collection.rowsByKey[expectedKey] || [];
    var issueRows = collection.uncertainRows.filter(function(issue) {
      return ["grade", "subject", "week"].every(function(field) {
        return !issue.identity[field] || issue.identity[field] === descriptor[field];
      });
    }).map(function(issue) { return issue.row; });
    var item = {
      grade: descriptor.grade, subject: descriptor.subject, week: descriptor.week,
      sourceRows: rowNumbers.slice(), issueRows: issueRows
    };
    if (filledByKey[expectedKey]) {
      records.push(filledByKey[expectedKey]);
      item.state = "filled";
      item.sourceRow = filledByKey[expectedKey].sourceRow;
    } else if (issueRows.length > 0) {
      item.state = "unverified";
      unverified.push(item);
    } else {
      item.state = rowNumbers.length ? "empty" : "not_found";
      missing.push(item);
    }
    evidence.push(item);
  }

  var result = {
    status: unverified.length || dataQuality.errorCount ? "partial" : "success",
    mode: mode,
    month: targetMonthFull,
    filters: buildPlanFilters_(gradeFilter, subjectFilter, weekFilter),
    totalExpected: expectedOrder.length,
    completedCount: records.length,
    missingCount: missing.length,
    emptyCount: missing.filter(function(item) { return item.state === "empty"; }).length,
    notFoundCount: missing.filter(function(item) { return item.state === "not_found"; }).length,
    unverifiedCount: unverified.length,
    isComplete: missing.length === 0 && unverified.length === 0,
    missing: missing,
    unverified: unverified,
    evidence: evidence,
    records: mode === "content" ? records : [],
    auditVersion: PLAN_MATCHING_VERSION,
    reportVersion: PLAN_REPORT_VERSION,
    sourceSheet: source.sheet.getName(),
    sourceSpreadsheetId: source.spreadsheetId,
    sourceSpreadsheetName: source.spreadsheetName,
    sourceUrl: source.url,
    checkedAt: source.checkedAt,
    diagnostics: collection.diagnostics,
    dataQuality: dataQuality,
    reportMessage: ""
  };

  result.gradeSummaries = summarizePlanGrades_(result);
  result.reportMessage = mode === "content"
    ? buildPlanContentReport_(result)
    : buildPlanMissingReport_(result);

  return result;
}

function buildPlanMissingReport_(result) {
  var summaries = result.gradeSummaries || summarizePlanGrades_(result);
  // نترك مساحة لإضافة إشعار نجاح الإصدار في مسار processPlans.
  var maxLength = 3700;
  for (var compact = 0; compact < 2; compact++) {
    var body = buildPlanGradeSummaryLines_(result, summaries, !!compact);
    for (var detailRows = 6; detailRows >= 0; detailRows--) {
      var lines = body.concat(buildPlanQualitySummaryLines_(result.dataQuality, detailRows));
      lines.push("", "المكتمل = محتوى موجود للأسابيع المقررة، وليس تقييمًا لجودته.");
      if (result.notFoundCount) lines.push("غياب السجل من هذا المصدر لا يثبت تقصير الكادر.");
      lines.push("فحص: " + result.checkedAt + " (بتوقيت غزة) | " + PLAN_REPORT_VERSION);
      var message = lines.join("\n");
      if (message.length <= maxLength) return message;
    }
  }
  // احتياط لتوسعات مستقبلية في المراحل/المواد: لا نقطع آخر المراحل بصمت.
  // القائمة الحالية بكل برامجها وحالات أسابيعها تتسع في الفروع أعلاه.
  var fallback = ["🔎 ملخص خطط " + result.month];
  summaries.forEach(function(grade) {
    fallback.push(grade.grade + ": " + grade.completedProgramCount + "/" + grade.totalProgramCount +
      " مكتملة؛ تحتاج مراجعة: " + grade.reviewProgramCount);
  });
  fallback.push("⚠️ تجاوز تفصيل البرامج سعة رسالة واحدة. لم تُعرض أسماء البرامج والأسابيع؛ اطلب كل مرحلة على حدة.");
  return fallback.concat(buildPlanQualitySummaryLines_(result.dataQuality, 0)).join("\n");
}

/** أعداد برامج لا أعداد صفوف أو أسابيع؛ مستمدة من دليل الفحص نفسه. */
function summarizePlanGrades_(result) {
  var grouped = {};
  (result.evidence || []).forEach(function(item) {
    if (!grouped[item.grade]) grouped[item.grade] = {};
    if (!grouped[item.grade][item.subject]) {
      grouped[item.grade][item.subject] = {subject: item.subject, weeks: []};
    }
    grouped[item.grade][item.subject].weeks.push({week: WEEKS.indexOf(item.week) + 1,
      state: item.state, sourceRows: (item.sourceRows || []).slice(), issueRows: (item.issueRows || []).slice()});
  });
  return Object.keys(GRADE_DOCS).filter(function(grade) { return !!grouped[grade]; }).map(function(grade) {
    var programs = getSubjectsForGrade_(grade).filter(function(subject) {
      return !!grouped[grade][subject];
    }).map(function(subject) {
      var program = grouped[grade][subject];
      program.weeks.sort(function(a, b) {return a.week - b.week;});
      program.isCompleteForSelection = program.weeks.length > 0 && program.weeks.every(function(week) {
        return week.state === "filled";
      });
      return program;
    });
    var completeCount = programs.filter(function(program) { return program.isCompleteForSelection; }).length;
    return {grade: grade, scope: result.filters && result.filters.week ? "week" : "month",
      totalProgramCount: programs.length, completedProgramCount: completeCount,
      reviewProgramCount: programs.length - completeCount, programs: programs};
  });
}

function buildPlanGradeSummaryLines_(result, summaries, compact) {
  var filters = result.filters || {};
  var lines = ["🔎 *ملخص خطط " + result.month + "*",
    "📊 " + result.completedCount + " معبأ من " + result.totalExpected + " أسبوعًا مطلوبًا."];
  if (filters.subject) lines.push("المادة: " + filters.subject);
  if (filters.week) lines.push("الفحص لـ" + filters.week + " فقط؛ الاكتمال يخص هذا الأسبوع لا الشهر كله.");
  if (result.totalExpected === 0) lines.push("", result.notRequiredMessage);
  var legend = [];
  if (result.notFoundCount) legend.push("رقم فقط = لا سجل مطابق");
  if (result.emptyCount) legend.push("ف = النشاط فارغ");
  if (result.unverifiedCount) legend.push("؟ = تعذر التحقق");
  if (legend.length) lines.push("الأسابيع بين القوسين: " + legend.join("؛ ") + ".");
  summaries.forEach(function(grade) {
    var complete = grade.programs.filter(function(program) {return program.isCompleteForSelection;});
    var review = grade.programs.filter(function(program) {return !program.isCompleteForSelection;});
    lines.push("", "🏫 *" + grade.grade + ":*");
    var completeLabel = filters.week ? "معبأة لهذا الأسبوع" : "برامج مكتملة";
    lines.push("✅ " + completeLabel + ": " + complete.length + " من " + grade.totalProgramCount);
    if (compact && complete.length) {
      lines.push(complete.map(function(program) {return program.subject;}).join("، "));
    } else {
      complete.forEach(function(program) {lines.push("• " + program.subject);});
    }
    lines.push((review.length ? "⚠️ " : "") + "برامج تحتاج مراجعة: " + review.length);
    review.forEach(function(program) {
      var weeks = program.weeks.filter(function(week) {return week.state !== "filled";}).map(function(week) {
        return String(week.week) + (week.state === "empty" ? "ف" : week.state === "unverified" ? "؟" : "");
      });
      lines.push((compact ? "" : "• ") + program.subject + " (" + weeks.join("،") + ")");
    });
  });
  if (filters.subject && !result.completedCount && !result.emptyCount && !result.unverifiedCount && result.totalExpected) {
    lines.push("", "لم أجد سجلًا باسم «" + filters.subject + "» ضمن اختيارك فقط.");
    if (filters.subject === "طبيب غرس" || filters.subject === "شيف غرس") {
      lines.push("«طبيب غرس» و«شيف غرس» برنامجان منفصلان؛ لا يُحتسب أحدهما للآخر.");
    }
  }
  return lines;
}

/** ملخص مستقل عن نواقص البرامج؛ يحفظ أخطاء الأسماء حتى في سؤال مادة أخرى. */
function buildPlanQualitySummaryLines_(quality, maxRows) {
  if (!quality) return [];
  var lines = ["", "🛠 أخطاء بيانات الشيت كله: " + quality.errorCount +
    (quality.errorCount ? " خلايا في " + quality.errorRowCount + " صفوف" : "")];
  var grouped = {};
  var rowOrder = [];
  (quality.errors || []).forEach(function(issue) {
    if (!grouped[issue.row]) {grouped[issue.row] = []; rowOrder.push(issue.row);}
    grouped[issue.row].push(issue);
  });
  rowOrder.slice(0, maxRows).forEach(function(row) {
    var issues = grouped[row];
    if (issues.length > 1) {
      lines.push("• الصف " + row + ": " + issues.map(function(issue) {return issue.cell;}).join("، ") +
        " — قيم غير صالحة.");
    } else {
      var issue = issues[0];
      var label = {month: "الشهر متعارض أو غير معروف", grade: "الصف غير معتمد",
        subject: "المادة غير معتمدة", week: "الأسبوع غير معتمد", activity: "محتوى يحتاج تصحيحًا"}[issue.field];
      var value = issue.field === "activity" ? "" : " «" +
        String(issue.value).replace(/[\r\n\t]+/g, " ").slice(0, 40) + "»";
      lines.push("• " + issue.cell + ": " + label + value);
    }
  });
  if (rowOrder.length > maxRows) lines.push("تفاصيل " + (rowOrder.length - maxRows) +
    " صفوف أخرى: أرسل «دقق الشيت كاملًا» أو شغّل testPlanDataQuality_.");
  if (quality.errorCount) lines.push("هذه أخطاء بيانات مستقلة عن عدد البرامج؛ بعضها خارج الشهر/المرحلة المطلوبة.");
  if (quality.outsideScheduleRowCount) lines.push("خارج الجدول الأسبوعي: " + quality.outsideScheduleRowCount + " صفًا؛ ليست نواقص.");
  if (quality.excludedRowCount) lines.push("صفوف برامج مستثناة: " + quality.excludedRowCount + ".");
  if (quality.duplicateRowCount) lines.push("صفوف مكررة: " + quality.duplicateRowCount + "؛ اعتمد آخر نشاط غير فارغ.");
  return lines;
}

/** اختبارات قراءة فقط لعرض الملخص الجديد دون إنشاء مستندات أو تعديل خلايا. */
function testPlanSummaryCurrentMonth_() {
  var result = inspectPlansForAPI_({mode: "missing"});
  console.log(result.reportMessage);
  return result;
}

function testPlanSummarySeptember_() {
  var result = inspectPlansForAPI_({month: "شهر 9", mode: "missing"});
  console.log(result.reportMessage);
  return result;
}

function buildPlanContentReport_(result) {
  var lines = [
    "📚 *محتوى الخطط المطلوبة*",
    "📅 " + result.month
  ];

  appendPlanFilterLines_(lines, result.filters);
  lines.push("📊 ضمن هذا الاختيار: " + result.completedCount + " معبأ من " +
    result.totalExpected + " أسبوعًا مطلوبًا.");
  appendPlanDiagnosticLines_(lines, result);
  appendPlanDataQualityLines_(lines, result.dataQuality, 4);

  if (result.records.length === 0) {
    return buildPlanMissingReport_(result);
  }

  for (var i = 0; i < result.records.length; i++) {
    var item = result.records[i];
    lines.push(
      "",
      "🏫 *" + item.grade + "* — " + item.subject + " — " + item.week,
      "صف المصدر: " + item.sourceRow,
      item.activity
    );
  }

  if (result.missingCount > 0 || result.unverifiedCount > 0) {
    lines.push(
      "",
      "ℹ️ ضمن الاختيار: " + result.emptyCount + " سجل نشاطه فارغ، " +
      result.notFoundCount + " بلا سجل مطابق، و" + result.unverifiedCount + " تعذر التحقق منها."
    );
  }

  return limitPlanReport_(lines.join("\n"));
}

function appendPlanFilterLines_(lines, filters) {
  lines.push("نطاق فحص الاكتمال/المحتوى:");
  lines.push("🏫 " + (filters.grade || "جميع المراحل"));
  lines.push("📘 " + (filters.subject || "جميع المواد المطلوبة"));
  if (filters.week) lines.push("🗓️ " + filters.week);
}

function buildPlanFilters_(grade, subject, week) {
  return {
    grade: grade || "",
    subject: subject || "",
    week: week || ""
  };
}

function makePlanKey_(grade, subject, week) {
  return String(grade || "").trim() + "|" +
    String(subject || "").trim() + "|" +
    String(week || "").trim();
}

function normalizePlanMonthForQuery_(value) {
  var raw = normalizeArabicDigitsForPlans_(value).trim();
  if (isEmptyPlanFilter_(raw)) {
    raw = "شهر " + Number(Utilities.formatDate(new Date(), PLAN_TIMEZONE, "M"));
  }
  var info = readStoredPlanMonth_(raw);
  if (info.month) return info.month;
  throw new Error("الشهر غير واضح أو اسمه ورقمه متعارضان: " + raw);
}

function normalizeExistingPlanMonth_(value) {
  return readStoredPlanMonth_(value).month;
}

function readStoredPlanMonth_(value) {
  var raw = normalizeArabicDigitsForPlans_(value).trim();
  if (isEmptyPlanFilter_(raw)) return {month: "", candidates: []};
  var normalized = normalizePlanQueryText_(raw);
  var aliases = {"يناير":1, "فبراير":2, "مارس":3, "ابريل":4, "مايو":5,
    "يونيو":6, "يوليو":7, "اغسطس":8, "سبتمبر":9, "اكتوبر":10, "نوفمبر":11, "ديسمبر":12};
  var numbers = (normalized.match(/[0-9]+/g) || []).map(Number);
  var named = Object.keys(aliases).filter(function(name) {
    return (" " + normalized + " ").indexOf(" " + name + " ") !== -1;
  }).map(function(name) { return aliases[name]; });
  var candidates = [];
  named.concat(numbers).forEach(function(number) {
    if (number >= 1 && number <= 12 && candidates.indexOf(number) === -1) candidates.push(number);
  });
  var simpleNumber = /^(?:(?:ال)?شهر\s*)?(?:1[0-2]|[1-9])$/.test(normalized);
  var valid = candidates.length === 1 && named.length <= 1 && numbers.length <= 1 &&
    numbers.every(function(number) { return number >= 1 && number <= 12; }) &&
    (named.length === 1 || simpleNumber);
  return {
    month: valid ? MONTH_MAP["شهر " + candidates[0]] : "",
    candidates: candidates.map(function(number) { return MONTH_MAP["شهر " + number]; })
  };
}

function validatePlanQuestionSubject_(question, subject) {
  if (!question || !subject) return;
  var text = normalizePlanQueryText_(question);
  var chef = /(?:^| )(?:ال)?شيف(?: |$)/.test(text);
  var doctor = /(?:^| )(?:ال)?طبيب(?: |$)/.test(text);
  if ((chef && !doctor && subject === "طبيب غرس") ||
      (doctor && !chef && subject === "شيف غرس")) {
    throw new Error("اسم البرنامج الذي استخرجه المساعد لا يطابق سؤالك. شيف غرس وطبيب غرس منفصلان؛ أعد الطلب بالاسم الكامل. لم أستنتج أي نواقص.");
  }
}

function resolvePlanGrade_(value, exactOnly) {
  return resolvePlanFilterFromList_(
    value,
    Object.keys(GRADE_DOCS),
    {
      "بستان": "البستان",
      "تمهيدي": "التمهيدي",
      "اول": "الصف الأول",
      "الاول": "الصف الأول",
      "ثاني": "الصف الثاني",
      "الثاني": "الصف الثاني",
      "ثالث": "الصف الثالث",
      "الثالث": "الصف الثالث",
      "رابع": "الصف الرابع",
      "الرابع": "الصف الرابع"
    },
    "الصف",
    exactOnly
  );
}

function resolvePlanSubject_(value, exactOnly) {
  return resolvePlanFilterFromList_(
    value,
    SUBJECTS,
    {
      "عربي": "اللغة العربية",
      "العربي": "اللغة العربية",
      "انجليزي": "اللغة الإنجليزية",
      "الانجليزي": "اللغة الإنجليزية",
      "رياضيات": "الرياضيات",
      "علوم": "العلوم",
      "نورانيه": "القاعدة النورانية",
      "نوراني": "القاعدة النورانية",
      "قران": "القرآن الكريم",
      "برمجه": "المبرمج الصغير",
      "مبرمج": "المبرمج الصغير",
      "مبتكر": "المبتكر الصغير",
      "دبكه": "الدبكة الشعبية",
      "لياقه": "اللياقة البدنية",
      "شيف": "شيف غرس",
      "الشيف": "شيف غرس",
      "الشيف غرس": "شيف غرس",
      "الشيف الصغير": "شيف غرس",
      "طبيب": "طبيب غرس",
      "الطبيب": "طبيب غرس",
      "الطبيب غرس": "طبيب غرس",
      "الطبيب الصغير": "طبيب غرس",
      "اتيكيت": "فن الاتيكيت",
      "الاتيكيت": "فن الاتيكيت",
      "فن الإتيكيت": "فن الاتيكيت",
      "فن الإتكيت": "فن الاتيكيت"
    },
    "المادة",
    exactOnly
  );
}

function resolvePlanWeek_(value, exactOnly) {
  return resolvePlanFilterFromList_(
    value,
    WEEKS,
    {
      "1": "الأسبوع الأول",
      "اول": "الأسبوع الأول",
      "الاول": "الأسبوع الأول",
      "الأسبوع 1": "الأسبوع الأول",
      "اسبوع 1": "الأسبوع الأول",
      "2": "الأسبوع الثاني",
      "ثاني": "الأسبوع الثاني",
      "الثاني": "الأسبوع الثاني",
      "الأسبوع 2": "الأسبوع الثاني",
      "اسبوع 2": "الأسبوع الثاني",
      "3": "الأسبوع الثالث",
      "ثالث": "الأسبوع الثالث",
      "الثالث": "الأسبوع الثالث",
      "الأسبوع 3": "الأسبوع الثالث",
      "اسبوع 3": "الأسبوع الثالث",
      "4": "الأسبوع الرابع",
      "رابع": "الأسبوع الرابع",
      "الرابع": "الأسبوع الرابع",
      "الأسبوع 4": "الأسبوع الرابع",
      "اسبوع 4": "الأسبوع الرابع"
    },
    "الأسبوع",
    exactOnly
  );
}

function resolvePlanFilterFromList_(value, allowedValues, aliases, label, exactOnly) {
  var raw = normalizeArabicDigitsForPlans_(value).trim();
  if (isEmptyPlanFilter_(raw)) return "";

  var normalized = normalizePlanQueryText_(raw);
  for (var i = 0; i < allowedValues.length; i++) {
    if (normalized === normalizePlanQueryText_(allowedValues[i])) {
      return allowedValues[i];
    }
  }

  aliases = aliases || {};
  for (var alias in aliases) {
    if (normalized === normalizePlanQueryText_(alias)) {
      if (allowedValues.indexOf(aliases[alias]) !== -1) return aliases[alias];
    }
  }

  // قيم الشيت لا تُطابق بالتخمين الجزئي؛ الاسم غير المعروف يُذكر في التشخيص.
  if (exactOnly) throw new Error(label + " غير معروف: " + raw);

  // قبول التطابق الجزئي للاستعلام فقط عندما ينتج عنه اختيار وحيد واضح.
  var candidates = [];
  for (var j = 0; j < allowedValues.length; j++) {
    var allowedNormalized = normalizePlanQueryText_(allowedValues[j]);
    if (allowedNormalized.indexOf(normalized) !== -1 ||
        normalized.indexOf(allowedNormalized) !== -1) {
      candidates.push(allowedValues[j]);
    }
  }
  if (candidates.length === 1) return candidates[0];

  throw new Error(label + " غير مفهوم: " + raw);
}

function isEmptyPlanFilter_(value) {
  var normalized = normalizePlanQueryText_(value);
  return !normalized || normalized === "null" || normalized === "undefined" ||
    normalized === "الكل" || normalized === "كل" ||
    normalized === "جميع" || normalized === "الجميع" ||
    normalized === "غير محدد";
}

function normalizeArabicDigitsForPlans_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/[٠-٩]/g, function(digit) {
      return String("٠١٢٣٤٥٦٧٨٩".indexOf(digit));
    })
    .replace(/[۰-۹]/g, function(digit) {
      return String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
    });
}

function normalizePlanQueryText_(value) {
  return normalizeArabicDigitsForPlans_(value).normalize("NFKC")
    .toLowerCase()
    .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ی/g, "ي")
    .replace(/ک/g, "ك")
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// 6.2 مصدر واحد وهوية موحدة للفحص والتعبئة
// ==========================================

function canonicalPlanHeaders_(headers) {
  var required = ["الشهر", "الصف", "المادة", "الأسبوع", "تفاصيل الأنشطة"];
  var seen = {};
  return headers.map(function(value) {
    var normalized = normalizePlanQueryText_(value);
    for (var i = 0; i < required.length; i++) {
      if (normalized === normalizePlanQueryText_(required[i])) {
        if (seen[required[i]]) throw new Error("عنوان عمود مكرر: " + required[i]);
        seen[required[i]] = true;
        return required[i];
      }
    }
    return String(value || "").trim();
  });
}

function getPlanSourceSheet_() {
  // اختياري: يُضبط مرة واحدة عند وجود أكثر من تبويب بالهيكل نفسه.
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = String(props.getProperty("GHARS_PLAN_SPREADSHEET_ID") || "").trim();
  var tabName = String(props.getProperty("GHARS_PLAN_SHEET_NAME") || "").trim();
  var spreadsheet = spreadsheetId
    ? SpreadsheetApp.openById(spreadsheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("لم يُحدد ملف بيانات الخطط. اضبط GHARS_PLAN_SPREADSHEET_ID بمعرف Google Sheets في خصائص النص البرمجي.");
  }
  if (tabName) {
    var selected = spreadsheet.getSheetByName(tabName);
    if (!selected) throw new Error("تبويب الخطط المحدد غير موجود: " + tabName);
    return selected;
  }

  var candidates = [];
  var sheets = spreadsheet.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    if (sheets[s].getLastRow() < 1 || sheets[s].getLastColumn() < 5) continue;
    var header = sheets[s].getRange(1, 1, 1, sheets[s].getLastColumn()).getDisplayValues()[0];
    try {
      validateRequiredColumns_(canonicalPlanHeaders_(header));
      candidates.push(sheets[s]);
    } catch (error) {
      // ليس تبويب بيانات خطط صالحًا؛ لا نختاره لأن ترتيبه الأول فقط.
    }
  }
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error("يوجد أكثر من تبويب لبيانات الخطط: " + candidates.map(function(sheet) {
      return sheet.getName();
    }).join("، ") + ". حدد اسم التبويب الصحيح في GHARS_PLAN_SHEET_NAME ضمن خصائص النص البرمجي.");
  }
  throw new Error("لم أجد تبويبًا بعناوين: الشهر، الصف، المادة، الأسبوع، تفاصيل الأنشطة. تحقق من ملف البيانات وعناوين الصف الأول.");
}

function readPlanSource_() {
  var sheet = getPlanSourceSheet_();
  var data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length === 0) throw new Error("تبويب الخطط فارغ.");
  var headers = canonicalPlanHeaders_(data[0]);
  validateRequiredColumns_(headers);
  var spreadsheet = typeof sheet.getParent === "function" ? sheet.getParent() : null;
  var spreadsheetId = spreadsheet ? spreadsheet.getId() : "";
  var sheetId = typeof sheet.getSheetId === "function" ? sheet.getSheetId() : "";
  return {
    sheet: sheet,
    data: data,
    headers: headers,
    spreadsheetId: spreadsheetId,
    spreadsheetName: spreadsheet ? spreadsheet.getName() : "",
    url: spreadsheetId ? "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/edit#gid=" + sheetId : "",
    checkedAt: Utilities.formatDate(new Date(), PLAN_TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
    columns: {
      month: headers.indexOf("الشهر"), grade: headers.indexOf("الصف"),
      subject: headers.indexOf("المادة"), week: headers.indexOf("الأسبوع"),
      activity: headers.indexOf("تفاصيل الأنشطة")
    }
  };
}

function resolveStoredPlanValue_(value, resolver) {
  try { return resolver(value, true); } catch (error) { return ""; }
}

function readStoredPlanIdentity_(row, columns) {
  return {
    month: normalizeExistingPlanMonth_(row[columns.month]),
    grade: resolveStoredPlanValue_(row[columns.grade], resolvePlanGrade_),
    subject: resolveStoredPlanValue_(row[columns.subject], resolvePlanSubject_),
    week: resolveStoredPlanValue_(row[columns.week], resolvePlanWeek_)
  };
}

function hasPlanActivity_(value) {
  return classifyPlanActivity_(value) === "filled";
}

function classifyPlanActivity_(value) {
  var visible = String(value === null || value === undefined ? "" : value)
    .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .trim();
  if (!visible) return "empty";
  if (/^(?:<<[^<>]+>>|\{\{[^{}]+\}\})$/.test(visible)) return "placeholder";
  if (/^#(?:REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NUM!|ERROR!|SPILL!|NULL!)$/.test(visible)) return "formula_error";
  return "filled";
}

function collectPlanRows_(source, targetMonthFull, filters) {
  filters = filters || {};
  var columns = source.columns;
  var found = {};
  var seen = {};
  var rowsByKey = {};
  var uncertainRows = [];
  var diagnostics = {
    sourceRowsRead: Math.max(0, source.data.length - 1),
    rowsInMonth: 0, matchedRows: 0, normalizedRowCount: 0,
    unrecognizedRowCount: 0, duplicateRowCount: 0, outsideScheduleRowCount: 0,
    normalizedRows: [], unrecognizedRows: []
  };
  for (var r = 1; r < source.data.length; r++) {
    var row = source.data[r];
    if (["month", "grade", "subject", "week", "activity"].every(function(field) {
      return String(row[columns[field]] || "").trim() === "";
    })) continue;
    var identity = readStoredPlanIdentity_(row, columns);
    var monthInfo = readStoredPlanMonth_(row[columns.month]);
    if (identity.month && identity.month !== targetMonthFull) continue;
    if (!identity.month && monthInfo.candidates.length && monthInfo.candidates.indexOf(targetMonthFull) === -1) continue;
    if (identity.month === targetMonthFull) diagnostics.rowsInMonth++;
    var fields = ["grade", "subject", "week"];
    var outsideScope = fields.some(function(field) {
      return filters[field] && identity[field] && filters[field] !== identity[field];
    });
    if (outsideScope) continue;
    if (identity.grade && identity.subject &&
        !isSubjectEnabledForGrade_(identity.grade, identity.subject)) continue;
    var unknown = fields.filter(function(field) { return !identity[field]; });
    if (!identity.month) unknown.unshift("month");
    if (unknown.length) {
      uncertainRows.push({row: r + 1, identity: identity});
      diagnostics.unrecognizedRowCount++;
      if (diagnostics.unrecognizedRows.length < 12) {
        diagnostics.unrecognizedRows.push({row: r + 1, fields: unknown,
          month: String(row[columns.month] || "").slice(0,120),
          grade: String(row[columns.grade] || "").slice(0,120),
          subject: String(row[columns.subject] || "").slice(0,120),
          week: String(row[columns.week] || "").slice(0,120)});
      }
      continue;
    }

    if (!isPlanWeekRequired_(identity.grade, identity.subject, identity.week)) {
      diagnostics.outsideScheduleRowCount++;
      continue;
    }

    diagnostics.matchedRows++;
    var changed = fields.filter(function(field) {
      return String(row[columns[field]] || "").trim() !== identity[field];
    });
    if (changed.length) {
      diagnostics.normalizedRowCount++;
      if (diagnostics.normalizedRows.length < 12) {
        diagnostics.normalizedRows.push({row: r + 1, fields: changed,
          grade: identity.grade, subject: identity.subject, week: identity.week});
      }
    }
    var key = makePlanKey_(identity.grade, identity.subject, identity.week);
    if (seen[key]) diagnostics.duplicateRowCount++;
    seen[key] = true;
    if (!rowsByKey[key]) rowsByKey[key] = [];
    rowsByKey[key].push(r + 1);
    var activityState = classifyPlanActivity_(row[columns.activity]);
    if (activityState === "formula_error" || activityState === "placeholder") {
      uncertainRows.push({row: r + 1, identity: identity});
      diagnostics.unrecognizedRowCount++;
      if (diagnostics.unrecognizedRows.length < 12) {
        diagnostics.unrecognizedRows.push({row: r + 1, fields: ["activity"],
          grade: identity.grade, subject: identity.subject, week: identity.week,
          reason: activityState});
      }
    }
    // يظل آخر نشاط غير فارغ هو المعتمد، كما في سياسة التعبئة الأصلية.
    if (activityState === "filled") {
      found[key] = {
        grade: identity.grade, subject: identity.subject, week: identity.week,
        activity: String(row[columns.activity]).trim(), sourceRow: r + 1
      };
    }
  }
  return {filledByKey: found, rowsByKey: rowsByKey, uncertainRows: uncertainRows, diagnostics: diagnostics};
}

/** تدقيق مستقل عن فلتر السؤال. يقرأ ولا يغيّر القيم أو يسمي المواد بالتخمين. */
function inspectPlanDataQuality_(source) {
  var c = source.columns;
  var errors = [], warnings = [], seen = {};
  var readRows = 0, outsideSchedule = 0, excludedRows = 0, duplicates = 0;
  var labels = {month: "الشهر", grade: "الصف", subject: "المادة", week: "الأسبوع", activity: "تفاصيل الأنشطة"};
  for (var r = 1; r < source.data.length; r++) {
    var row = source.data[r];
    if (["month", "grade", "subject", "week", "activity"].every(function(field) {
      return String(row[c[field]] === undefined || row[c[field]] === null ? "" : row[c[field]]).trim() === "";
    })) continue;
    readRows++;
    var id = readStoredPlanIdentity_(row, c);
    var monthInfo = readStoredPlanMonth_(row[c.month]);
    var rowErrors = [];
    ["month", "grade", "subject", "week"].forEach(function(field) {
      if (id[field]) return;
      rowErrors.push({field: field, code: "invalid_" + field,
        reason: field === "month" ? "الشهر غير معروف أو اسمه ورقمه متعارضان" :
          labels[field] + " فارغ أو غير معتمد"});
    });
    var activityState = classifyPlanActivity_(row[c.activity]);
    if (activityState === "formula_error" || activityState === "placeholder") {
      rowErrors.push({field: "activity", code: activityState,
        reason: activityState === "formula_error" ? "خطأ صيغة في خلية النشاط" : "وسم استدعاء وليس محتوى نشاط"});
    }
    rowErrors.forEach(function(issue) {
      errors.push({row: r + 1, cell: planColumnLetter_(c[issue.field] + 1) + (r + 1),
        field: issue.field, code: issue.code, reason: issue.reason,
        value: String(row[c[issue.field]] === undefined || row[c[issue.field]] === null ? "" : row[c[issue.field]]).slice(0,120),
        month: id.month, candidateMonths: monthInfo.candidates,
        grade: id.grade || String(row[c.grade] || "").slice(0,80),
        subject: id.subject || String(row[c.subject] || "").slice(0,80),
        week: id.week || String(row[c.week] || "").slice(0,80)});
    });
    if (!id.month || !id.grade || !id.subject || !id.week) continue;
    var warning = {row: r + 1, month: id.month, grade: id.grade, subject: id.subject, week: id.week};
    if (!isSubjectEnabledForGrade_(id.grade, id.subject)) {
      warning.code = "excluded_subject";
      excludedRows++;
      warnings.push(warning);
      continue;
    }
    if (!isPlanWeekRequired_(id.grade, id.subject, id.week)) {
      warning.code = "outside_schedule";
      outsideSchedule++;
      warnings.push(warning);
      continue;
    }
    var key = id.month + "|" + makePlanKey_(id.grade, id.subject, id.week);
    if (seen[key]) {
      warning.code = "duplicate";
      warning.previousRow = seen[key];
      duplicates++;
      warnings.push(warning);
    }
    seen[key] = r + 1;
  }
  return {
    scope: "all_source_rows_all_months", rowsScanned: Math.max(0, source.data.length - 1),
    nonemptyRows: readRows, blankRows: Math.max(0, source.data.length - 1 - readRows), errorCount: errors.length,
    errorRowCount: uniqueStrings_(errors.map(function(issue) { return issue.row; })).length,
    warningCount: warnings.length, outsideScheduleRowCount: outsideSchedule,
    excludedRowCount: excludedRows, duplicateRowCount: duplicates,
    errors: errors, warnings: warnings
  };
}

function planColumnLetter_(column) {
  var value = "";
  while (column > 0) {
    column--;
    value = String.fromCharCode(65 + column % 26) + value;
    column = Math.floor(column / 26);
  }
  return value;
}

function planQualityIssueLine_(issue) {
  var raw = issue.field === "activity" ? "" : " «" +
    String(issue.value).replace(/[\r\n\t]+/g, " ").slice(0,55) + "»";
  return "• " + issue.cell + ": " + issue.reason + raw + " — " +
    [issue.grade, issue.month || "شهر غير محسوم", issue.week].join(" / ");
}

function appendPlanDataQualityLines_(lines, quality, limit) {
  if (!quality) return;
  lines.push("", "🛡️ سلامة بيانات الشيت كله — جميع الأشهر والمراحل:");
  if (quality.errorCount) {
    lines.push("⚠️ " + quality.errorCount + " أخطاء بيانات في " + quality.errorRowCount +
      " صفوف. بعضها قد يكون خارج اختيارك؛ لا تعني تقصيرًا من الكادر.");
    quality.errors.slice(0,limit).forEach(function(issue) {lines.push(planQualityIssueLine_(issue));});
    if (quality.errors.length > limit) {
      lines.push("وهناك " + (quality.errors.length - limit) +
        " أخطاء أخرى. شغّل testPlanDataQuality_ من Apps Script لعرض كل الخلايا في سجل التنفيذ.");
    }
  } else {
    lines.push("لم أجد أسماء غير معتمدة أو هوية صف متعارضة أو خطأ خلية ظاهرًا؛ هذا لا يثبت اكتمال الخطط.");
  }
  if (quality.outsideScheduleRowCount) {
    lines.push("ℹ️ " + quality.outsideScheduleRowCount +
      " صفوف موجودة خارج الجدول الأسبوعي الحالي في الشيت كله؛ حُفظت في المصدر ولا تُعبأ ولا تُحسب كنواقص.");
  }
  if (quality.excludedRowCount) lines.push("ℹ️ صفوف مواد مستثناة لهذه المرحلة: " + quality.excludedRowCount + " (لم تُحذف).");
  if (quality.duplicateRowCount) lines.push("ℹ️ صفوف مكررة: " + quality.duplicateRowCount + ". سياسة القراءة: آخر نشاط غير فارغ.");
}

function buildPlanDataQualityResult_(source, quality) {
  var result = {
    status: quality.errorCount ? "partial" : "success", mode: "audit",
    auditVersion: PLAN_MATCHING_VERSION, reportVersion: PLAN_REPORT_VERSION, checkedAt: source.checkedAt,
    sourceSpreadsheetId: source.spreadsheetId, sourceSpreadsheetName: source.spreadsheetName,
    sourceSheet: source.sheet.getName(), sourceUrl: source.url,
    dataQuality: quality, reportMessage: ""
  };
  var lines = ["🔎 *تدقيق سلامة الشيت كاملًا*", source.spreadsheetName + " / " + result.sourceSheet,
    source.url, "فحص " + PLAN_MATCHING_VERSION + " — " + source.checkedAt + " (" + PLAN_TIMEZONE + ")",
    "نطاق القراءة: " + quality.rowsScanned + " صفوف؛ السجلات غير الفارغة: " + quality.nonemptyRows +
      ". دون إنشاء ملفات أو تعديل خلايا."];
  appendPlanDataQualityLines_(lines, quality, 12);
  lines.push("", "الجدول الخاص للبرامج: " + getRestrictedSubjectScheduleSummary_() +
    ". يطبّق على الصفوف التي يُطلب فيها كل برنامج.",
    "هذا تدقيق بيانات لا تقرير اكتمال. لعرض النواقص اطلب فحص الخطط وحدد الشهر المطلوب.");
  result.reportMessage = limitPlanReport_(lines.join("\n"));
  return result;
}

function preflightPlanGeneration_(targetMonth, source) {
  var audit = inspectPlansForAPI_({month: targetMonth, mode: "missing"}, source);
  var relevantErrors = audit.dataQuality.errors.filter(function(issue) {
    return issue.month === audit.month || (!issue.month &&
      (!issue.candidateMonths.length || issue.candidateMonths.indexOf(audit.month) !== -1));
  });
  if (relevantErrors.length || audit.unverifiedCount) {
    var cells = uniqueStrings_(relevantErrors.map(function(issue) { return issue.cell; })).slice(0,12);
    throw new Error("توقفت قبل تعديل المستندات: بيانات الشهر تحتاج تصحيحًا" +
      (cells.length ? " في الخلايا " + cells.join("، ") : "") +
      ". اطلب تدقيق الشيت كاملًا، وصحّح أسماء المواد/الأشهر/الأسابيع أو أخطاء الخلايا ثم أعد المحاولة.");
  }
  return audit;
}

/** فحص قراءة فقط لوسوم الجدول الجديد في القالب الموجود نفسه. */
function validateCurriculumTemplate_() {
  var doc = DocumentApp.openById(MASTER_TEMPLATE_ID);
  var parts = getPrimaryDocumentParts_(doc);
  var sections = [parts.body, parts.header, parts.footer].filter(function(section) { return !!section; });
  var missing = [], forbidden = [];
  Object.keys(SUBJECT_WEEKS).forEach(function(subject) {
    WEEKS.forEach(function(week) {
      var tag = "<<" + subject + "_" + week + ">>";
      // findText يستخدم البحث نفسه الذي يستخدمه replaceText؛ لا يكفي وجود الوسم
      // كنص موزع على أكثر من كتلة لا يمكن استبدالها بالطريقة الحالية.
      var exists = sections.some(function(section) { return !!section.findText(escapeRegexForDocs_(tag)); });
      if (getWeeksForSubject_(subject).indexOf(week) !== -1 && !exists) missing.push(tag);
      if (getWeeksForSubject_(subject).indexOf(week) === -1 && exists) forbidden.push(tag);
    });
  });
  if (missing.length || forbidden.length) {
    throw new Error("القالب المخفي لم يُضبط بعد للجدول الجديد. عدّل القالب نفسه دون تغيير رابطه." +
      (missing.length ? " أضف الوسوم: " + missing.join("، ") + "." : "") +
      (forbidden.length ? " احذف كتل الأسابيع غير المقررة بعناوينها ووسومها: " + forbidden.join("، ") + "." : "") +
      " لم يُمسح أي مستند بواسطة هذه العملية.");
  }
  return {status: "success", auditVersion: PLAN_MATCHING_VERSION,
    message: "وسوم البرامج ذات الأسابيع المحددة سليمة: " +
      getRestrictedSubjectScheduleSummary_() + ". لم يُعدّل أي مستند."};
}

function testCurriculumTemplate_() {
  var result = validateCurriculumTemplate_();
  console.log(result.message);
  return result;
}

/** من قائمة الدوال اختر هذه الدالة. كل خطأ يُسجل في سطر صغير مستقل. */
function testPlanDataQuality_() {
  var result = inspectPlansForAPI_({mode: "audit"});
  console.log("نسخة عرض الملخص: " + PLAN_REPORT_VERSION);
  console.log("نسخة واجهة التعبئة: " + PLAN_UI_VERSION);
  console.log("نسخة الفحص " + result.auditVersion + " | " + result.sourceSheet +
    " | صفوف النطاق: " + result.dataQuality.rowsScanned +
    " | سجلات غير فارغة: " + result.dataQuality.nonemptyRows +
    " | أخطاء خلايا: " + result.dataQuality.errorCount +
    " | صفوف متأثرة: " + result.dataQuality.errorRowCount);
  console.log("المصدر: " + result.sourceSpreadsheetName + " | " + result.sourceSpreadsheetId);
  console.log(result.sourceUrl);
  result.dataQuality.errors.forEach(function(issue) { console.log(planQualityIssueLine_(issue)); });
  console.log("خارج الجدول الحالي: " + result.dataQuality.outsideScheduleRowCount +
    " | مكرر: " + result.dataQuality.duplicateRowCount + " | لم تُعدّل أي خلية أو مستند.");
  return result;
}

function appendPlanDiagnosticLines_(lines, result) {
  var d = result.diagnostics || {};
  if (result.sourceSheet) lines.push("🗂️ " + (result.sourceSpreadsheetName ? result.sourceSpreadsheetName + " / " : "") + result.sourceSheet);
  if (result.sourceUrl) lines.push(result.sourceUrl);
  lines.push("فحص " + result.auditVersion + " — " + result.checkedAt + " (" + PLAN_TIMEZONE + ")");
  lines.push("صفوف نطاق القراءة: " + d.sourceRowsRead +
    (result.dataQuality ? "؛ سجلات غير فارغة: " + result.dataQuality.nonemptyRows : "") +
    "؛ المسجلة للشهر المحدد: " + d.rowsInMonth + ".");
  if (d.unrecognizedRowCount) {
    lines.push("⚠️ صفوف تحتاج مراجعة لتعارض الشهر أو قيمة غير معروفة/خطأ خلية: " +
      d.unrecognizedRows.map(function(row) { return row.row; }).join("، "));
  }
  if (d.duplicateRowCount) {
    lines.push("ℹ️ توجد صفوف مكررة؛ اعتُمد آخر محتوى غير فارغ لكل أسبوع.");
  }
}

/** اسمان قديمان محفوظان للتوافق؛ الاختبار الآن عام وليس مقيدًا بالشيف أو سبتمبر. */
function testChefSeptember_() {
  return testPlanDataQuality_();
}

function testPlanAuditSeptember_() {
  return testPlanDataQuality_();
}

function limitPlanReport_(message) {
  var maxLength = 3800;
  message = String(message || "");
  if (message.length <= maxLength) return message;

  return message.substring(0, maxLength) +
    "\n\n… تم اختصار النتيجة لطول رسالة واتساب. حدّد صفاً أو مادة أو أسبوعاً لعرض أدق.";
}

// -----------------------------------------------------------------
// 7. دالة الاستنساخ العميق (Reset) للحفاظ على التصميم والألوان 100%
// -----------------------------------------------------------------
function advancedResetFromMaster_() {
  var masterDoc = DocumentApp.openById(MASTER_TEMPLATE_ID);
  var masterParts = getPrimaryDocumentParts_(masterDoc);
  var masterNamedStyles = loadMasterNamedStyles_();
  var errors = [];

  // فحص القالب قبل مسح أي ملف عام حتى لا يتوقف النسخ بعد بدء المسح.
  validateTopLevelElements_(masterParts.body, "جسم القالب");
  if (masterParts.header) validateTopLevelElements_(masterParts.header, "رأس القالب");
  if (masterParts.footer) validateTopLevelElements_(masterParts.footer, "تذييل القالب");

  for (var grade in GRADE_DOCS) {
    try {
      resetOneGradeFromMaster_(grade, masterParts, masterNamedStyles);
    } catch (e) {
      var message = grade + ": " + (e && e.message ? e.message : e);
      errors.push(message);
      console.error("فشل تصفير " + message);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      "فشل تصفير بعض ملفات الصفوف:\n" + errors.join("\n")
    );
  }
}

function resetOneGradeFromMaster_(grade, masterParts, masterNamedStyles) {
  if (!GRADE_DOCS.hasOwnProperty(grade)) {
    throw new Error("اسم الصف غير موجود في GRADE_DOCS: " + grade);
  }

  var targetDocumentId = GRADE_DOCS[grade];

  // الخطوة الحاسمة: نسخ تعريفات NORMAL_TEXT وTITLE وHEADING_1/2...
  // قبل إدخال الفقرات، حتى لا ترث ألوان وخطوط الملف الهدف القديمة.
  syncNamedStylesToTarget_(targetDocumentId, masterNamedStyles);

  var targetDoc = DocumentApp.openById(targetDocumentId);
  var targetParts = getPrimaryDocumentParts_(targetDoc);

  // إعدادات الصفحة لا تنتقل عند نسخ عناصر Body، لذلك ننقلها صراحةً.
  copyPageSettings_(masterParts.body, targetParts.body);

  // نسخ العناصر ثم تثبيت الخصائص المباشرة لكل فقرة ولكل جزء نصي.
  // هذا يمنع عنوان 1/2 من أخذ ألوان الملف المستقبِل.
  replaceContainerExactly_(masterParts.body, targetParts.body);

  copyOptionalSectionExactly_(
    masterParts.header,
    targetParts.header,
    targetParts.addHeader
  );
  copyOptionalSectionExactly_(
    masterParts.footer,
    targetParts.footer,
    targetParts.addFooter
  );

  // بعد نسخ القالب الموحد نحذف أقسام المواد غير المطلوبة لهذا الصف بالكامل.
  // الحذف يشمل العنوان وكل الفقرات/الجداول الواقعة تحته حتى عنوان المادة التالية.
  removeExcludedSubjectSectionsFromDocument_(targetDoc, grade);

  targetDoc.saveAndClose();
  console.log("تمت إعادة ضبط ملف: " + grade);
}

// -----------------------------------------------------------------
// 7.0 مزامنة Named Styles عبر Google Docs API
// -----------------------------------------------------------------

/**
 * يقرأ تعريفات الأنماط الموروثة من القالب المخفي.
 * يتطلب تفعيل Google Docs API من: Services (+) داخل مشروع Apps Script.
 */
function loadMasterNamedStyles_() {
  if (typeof Docs === "undefined") {
    throw new Error(
      "خدمة Google Docs API غير مفعلة. من محرر Apps Script افتح Services (+)، " +
      "اختر Google Docs API ثم Add، وبعدها أعد الاختبار."
    );
  }

  try {
    var apiDocument = Docs.Documents.get(MASTER_TEMPLATE_ID, {
      includeTabsContent: true
    });

    if (!apiDocument.tabs || !apiDocument.tabs.length ||
        !apiDocument.tabs[0].documentTab ||
        !apiDocument.tabs[0].documentTab.namedStyles ||
        !apiDocument.tabs[0].documentTab.namedStyles.styles) {
      throw new Error("لم يتم العثور على Named Styles داخل أول Tab في القالب.");
    }

    return apiDocument.tabs[0].documentTab.namedStyles.styles;
  } catch (error) {
    throw new Error(
      "تعذر قراءة أنماط القالب بواسطة Google Docs API: " +
      (error.message || error)
    );
  }
}

/**
 * ينسخ جميع Named Styles إلى الملف الثابت دون تغيير ID أو رابط الملف.
 */
function syncNamedStylesToTarget_(targetDocumentId, masterNamedStyles) {
  var requests = [];

  for (var i = 0; i < masterNamedStyles.length; i++) {
    var namedStyle = sanitizeNamedStyleForUpdate_(masterNamedStyles[i]);
    if (!namedStyle.namedStyleType ||
        namedStyle.namedStyleType === "NAMED_STYLE_TYPE_UNSPECIFIED") {
      continue;
    }

    var fields = ["namedStyleType"];
    if (namedStyle.textStyle) fields.push("textStyle");
    if (namedStyle.paragraphStyle) fields.push("paragraphStyle");

    requests.push({
      updateNamedStyle: {
        namedStyle: namedStyle,
        fields: fields.join(",")
        // tabId غير مطلوب هنا؛ الطلب يطبق على أول Tab.
      }
    });
  }

  if (requests.length === 0) {
    throw new Error("القالب لا يحتوي على Named Styles قابلة للنقل.");
  }

  try {
    Docs.Documents.batchUpdate({ requests: requests }, targetDocumentId);
  } catch (error) {
    throw new Error(
      "فشلت مزامنة أنماط العناوين إلى الملف الهدف: " +
      (error.message || error)
    );
  }
}

/**
 * يحذف الحقول المقروءة فقط قبل إرسال النمط إلى UpdateNamedStyleRequest.
 */
function sanitizeNamedStyleForUpdate_(sourceStyle) {
  var style = JSON.parse(JSON.stringify(sourceStyle || {}));

  if (style.paragraphStyle) {
    delete style.paragraphStyle.headingId;
    delete style.paragraphStyle.namedStyleType;
  }

  if (style.textStyle) {
    // الروابط ليست جزءاً مطلوباً من تعريف نمط العنوان وقد تُرفض عند النسخ.
    delete style.textStyle.link;
  }

  return style;
}

// -----------------------------------------------------------------
// 7.1 أدوات النسخ المطابق مع إبقاء روابط ملفات الصفوف ثابتة
// -----------------------------------------------------------------

/**
 * يعيد جسم/رأس/تذييل أول Tab في المستند.
 * يدعم مستندات Google Docs الحديثة التي تحتوي على Tabs، مع توافق خلفي.
 */
function getPrimaryDocumentParts_(doc) {
  if (typeof doc.getTabs === "function") {
    var tabs = doc.getTabs();
    if (!tabs || tabs.length === 0) {
      throw new Error("المستند لا يحتوي على Tab صالح.");
    }

    var documentTab = tabs[0].asDocumentTab();
    return {
      body: documentTab.getBody(),
      header: documentTab.getHeader(),
      footer: documentTab.getFooter(),
      addHeader: function() { return documentTab.addHeader(); },
      addFooter: function() { return documentTab.addFooter(); }
    };
  }

  return {
    body: doc.getBody(),
    header: doc.getHeader(),
    footer: doc.getFooter(),
    addHeader: function() { return doc.addHeader(); },
    addFooter: function() { return doc.addFooter(); }
  };
}

/**
 * ينقل حجم الصفحة والهوامش. هذه القيم لا تنتقل مع appendParagraph/appendTable.
 */
function copyPageSettings_(sourceBody, targetBody) {
  copyNumericSetting_(sourceBody, targetBody, "getPageWidth", "setPageWidth");
  copyNumericSetting_(sourceBody, targetBody, "getPageHeight", "setPageHeight");
  copyNumericSetting_(sourceBody, targetBody, "getMarginTop", "setMarginTop");
  copyNumericSetting_(sourceBody, targetBody, "getMarginBottom", "setMarginBottom");
  copyNumericSetting_(sourceBody, targetBody, "getMarginLeft", "setMarginLeft");
  copyNumericSetting_(sourceBody, targetBody, "getMarginRight", "setMarginRight");
}

function copyNumericSetting_(source, target, getterName, setterName) {
  if (typeof source[getterName] !== "function" ||
      typeof target[setterName] !== "function") {
    return;
  }

  var value = source[getterName]();
  if (value !== null && value !== undefined) {
    try {
      target[setterName](value);
    } catch (error) {
      // بعض المستندات تكون Pageless وترفض مقاسات أو هوامش الصفحات.
      console.warn("تم تجاوز إعداد صفحة غير قابل للنقل " + setterName + ": " + (error.message || error));
    }
  }
}

/**
 * ينسخ الهيدر أو الفوتر. إذا لم يكن موجوداً في القالب يتم تفريغ الموجود في الهدف.
 */
function copyOptionalSectionExactly_(sourceSection, targetSection, createSection) {
  if (!sourceSection) {
    if (targetSection) targetSection.clear();
    return;
  }

  if (!targetSection) targetSection = createSection();
  replaceContainerExactly_(sourceSection, targetSection);
}

/**
 * يمسح الحاوية ثم ينسخ عناصرها، وبعد النسخ يثبت كل الخصائص مباشرةً.
 */
function replaceContainerExactly_(sourceContainer, targetContainer) {
  var sourceCount = sourceContainer.getNumChildren();

  targetContainer.clear();

  var hasAutomaticEmptyParagraph =
    targetContainer.getNumChildren() === 1 &&
    targetContainer.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH &&
    targetContainer.getChild(0).getText() === "";

  for (var i = 0; i < sourceCount; i++) {
    try {
      var sourceChild = sourceContainer.getChild(i);
      var targetChild = appendCopiedTopLevelElement_(sourceChild, targetContainer);
      syncElementStylesRecursively_(sourceChild, targetChild);
    } catch (error) {
      var childType = sourceContainer.getChild(i).getType();
      throw new Error(
        "فشل نسخ العنصر رقم " + (i + 1) +
        " من النوع " + childType + ": " + (error.message || error)
      );
    }
  }

  // clear() قد يترك فقرة فارغة إلزامية؛ نحذفها بعد إضافة المحتوى الحقيقي.
  if (hasAutomaticEmptyParagraph &&
      targetContainer.getNumChildren() > sourceCount &&
      targetContainer.getChild(0).getType() === DocumentApp.ElementType.PARAGRAPH &&
      targetContainer.getChild(0).getText() === "") {
    targetContainer.removeChild(targetContainer.getChild(0));
  }

}

function appendCopiedTopLevelElement_(sourceElement, targetContainer) {
  var type = sourceElement.getType();
  var copy = sourceElement.copy();

  if (type === DocumentApp.ElementType.PARAGRAPH) {
    return targetContainer.appendParagraph(copy);
  }
  if (type === DocumentApp.ElementType.TABLE) {
    return targetContainer.appendTable(copy);
  }
  if (type === DocumentApp.ElementType.LIST_ITEM) {
    return targetContainer.appendListItem(copy);
  }
  if (type === DocumentApp.ElementType.PAGE_BREAK &&
      typeof targetContainer.appendPageBreak === "function") {
    return targetContainer.appendPageBreak(copy);
  }
  if (type === DocumentApp.ElementType.HORIZONTAL_RULE &&
      typeof targetContainer.appendHorizontalRule === "function") {
    return targetContainer.appendHorizontalRule();
  }

  throw new Error("نوع عنصر غير مدعوم في القالب: " + type);
}

/**
 * يثبت خصائص العناصر المنسوخة بصورة متكررة، بما فيها:
 * - خصائص الفقرة: الاتجاه، المحاذاة، المسافات والعنوان.
 * - خصائص أجزاء النص: الخط، الحجم، اللون، العريض والخلفية.
 * - خصائص الجداول والصفوف والخلايا والصور.
 */
function syncElementStylesRecursively_(sourceElement, targetElement) {
  if (!sourceElement || !targetElement) return;

  var type = sourceElement.getType();

  // يجب تعيين نوع العنوان أولاً، ثم وضع الخصائص المباشرة فوقه.
  if ((type === DocumentApp.ElementType.PARAGRAPH ||
       type === DocumentApp.ElementType.LIST_ITEM) &&
      typeof sourceElement.getHeading === "function" &&
      typeof targetElement.setHeading === "function") {
    var heading = sourceElement.getHeading();
    if (heading !== null && heading !== undefined) {
      try {
        targetElement.setHeading(heading);
      } catch (error) {
        console.warn("تم تجاوز Heading غير قابل للنقل: " + (error.message || error));
      }
    }
  }

  applyDirectAttributes_(sourceElement, targetElement);

  if (type === DocumentApp.ElementType.TEXT) {
    syncTextRuns_(sourceElement.asText(), targetElement.asText());
    return;
  }

  if (typeof sourceElement.getNumChildren !== "function" ||
      typeof targetElement.getNumChildren !== "function") {
    return;
  }

  var childCount = Math.min(
    sourceElement.getNumChildren(),
    targetElement.getNumChildren()
  );

  for (var i = 0; i < childCount; i++) {
    syncElementStylesRecursively_(
      sourceElement.getChild(i),
      targetElement.getChild(i)
    );
  }
}

/**
 * يثبت خصائص كل Text Run؛ هذا هو الجزء الذي يمنع لون عنوان 1/2 من التغير.
 */
function syncTextRuns_(sourceText, targetText) {
  var sourceValue = sourceText.getText();
  if (!sourceValue || sourceValue.length === 0) return;

  var starts = sourceText.getTextAttributeIndices();
  for (var i = 0; i < starts.length; i++) {
    var start = starts[i];
    var end = (i + 1 < starts.length ? starts[i + 1] : sourceValue.length) - 1;
    var attributes = removeNullAttributes_(sourceText.getAttributes(start));

    if (end >= start && Object.keys(attributes).length > 0) {
      setTextAttributesSafely_(targetText, start, end, attributes);
    }
  }
}

/**
 * Google Docs قد يعيد خصائص داخلية صحيحة للقراءة لكنه يرفض كتابتها في مستند آخر.
 * لذلك نطبق كل خاصية منفردة؛ فشل خاصية واحدة لا يوقف نسخ بقية التنسيق.
 */
function setTextAttributesSafely_(targetText, start, end, attributes) {
  for (var key in attributes) {
    var singleAttribute = {};
    singleAttribute[key] = attributes[key];

    try {
      targetText.setAttributes(start, end, singleAttribute);
    } catch (error) {
      console.warn(
        "تم تجاوز خاصية نص غير قابلة للنقل " + key +
        " عند المدى " + start + "-" + end + ": " + (error.message || error)
      );
    }
  }
}

function applyDirectAttributes_(sourceElement, targetElement) {
  if (typeof sourceElement.getAttributes !== "function" ||
      typeof targetElement.setAttributes !== "function") {
    return;
  }

  var attributes = removeNullAttributes_(sourceElement.getAttributes());
  for (var key in attributes) {
    var singleAttribute = {};
    singleAttribute[key] = attributes[key];

    try {
      targetElement.setAttributes(singleAttribute);
    } catch (error) {
      console.warn("تم تجاوز خاصية عنصر غير قابلة للنقل " + key + ": " + (error.message || error));
    }
  }
}

function removeNullAttributes_(attributes) {
  var result = {};
  attributes = attributes || {};

  for (var key in attributes) {
    if (attributes[key] !== null && attributes[key] !== undefined) {
      result[key] = attributes[key];
    }
  }

  return result;
}

/**
 * يمنع مسح ملفات الصفوف إذا احتوى القالب على عنصر لا يستطيع الناسخ معالجته.
 */
function validateTopLevelElements_(container, label) {
  for (var i = 0; i < container.getNumChildren(); i++) {
    var type = container.getChild(i).getType();
    var supported =
      type === DocumentApp.ElementType.PARAGRAPH ||
      type === DocumentApp.ElementType.TABLE ||
      type === DocumentApp.ElementType.LIST_ITEM ||
      type === DocumentApp.ElementType.PAGE_BREAK ||
      type === DocumentApp.ElementType.HORIZONTAL_RULE;

    if (!supported) {
      throw new Error(label + " يحتوي على عنصر غير مدعوم: " + type);
    }
  }
}

// -----------------------------------------------------------------
// 7.2 حذف أقسام المواد غير المطلوبة من نسخة الصف فقط
// -----------------------------------------------------------------

/**
 * يحذف العنوان وكل محتوى المادة من المستند الهدف بعد نسخ القالب.
 * لا يعدّل القالب المخفي، ولا يؤثر على أي صف غير موجود في خريطة الاستثناءات.
 */
function removeExcludedSubjectSectionsFromDocument_(doc, grade) {
  var excludedSubjects = EXCLUDED_SUBJECTS_BY_GRADE[grade] || [];
  if (excludedSubjects.length === 0) return;

  var excludedLookup = {};
  for (var i = 0; i < excludedSubjects.length; i++) {
    excludedLookup[excludedSubjects[i]] = true;
  }

  var parts = getPrimaryDocumentParts_(doc);
  var sections = [parts.body, parts.header, parts.footer];
  var removedCount = 0;

  for (var s = 0; s < sections.length; s++) {
    if (sections[s]) {
      removedCount += removeExcludedSectionsFromContainer_(
        sections[s],
        excludedLookup
      );
    }
  }

  // حماية من إصدار ملف ناقص التنظيف إذا تغيّر بناء القالب لاحقاً.
  var remaining = [];
  for (var p = 0; p < sections.length; p++) {
    if (!sections[p]) continue;
    var headings = collectSubjectHeadings_(sections[p]);
    for (var h = 0; h < headings.length; h++) {
      if (excludedLookup[headings[h]]) remaining.push(headings[h]);
    }
  }

  if (remaining.length > 0) {
    throw new Error(
      "تعذر حذف أقسام المواد المستثناة من " + grade + ": " +
      uniqueStrings_(remaining).join("، ")
    );
  }

  console.log(
    "تم حذف " + removedCount + " قسم/صف خاص بالمواد المستثناة من " + grade
  );
}

/**
 * يدعم شكلي القالب الشائعين:
 * 1) كل مادة في صف مستقل داخل جدول: يحذف صف الجدول كاملاً.
 * 2) عدة مواد متتابعة داخل خلية/جسم واحد: يحذف من عنوان المادة حتى العنوان التالي.
 */
function removeExcludedSectionsFromContainer_(container, excludedLookup) {
  var removedCount = 0;

  // أولاً نعالج الجداول وصفوفها من الأسفل للأعلى حتى لا تتغيّر الفهارس.
  for (var i = container.getNumChildren() - 1; i >= 0; i--) {
    var child = container.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.TABLE) continue;

    var table = child.asTable();
    var tableWasRemoved = false;
    for (var r = table.getNumRows() - 1; r >= 0; r--) {
      var row = table.getRow(r);
      var rowHeadings = collectSubjectHeadings_(row);
      var hasExcludedHeading = false;
      var hasIncludedHeading = false;

      for (var rh = 0; rh < rowHeadings.length; rh++) {
        if (excludedLookup[rowHeadings[rh]]) {
          hasExcludedHeading = true;
        } else {
          hasIncludedHeading = true;
        }
      }

      // إذا كان الصف مخصصاً بالكامل لمادة مستثناة نحذفه بكامل تنسيقه ومحتواه.
      if (hasExcludedHeading && !hasIncludedHeading) {
        // Google Docs لا يقبل أحياناً جدولاً بلا صفوف؛ عند آخر صف نحذف الجدول نفسه.
        if (table.getNumRows() === 1) {
          container.removeChild(child);
          tableWasRemoved = true;
        } else {
          table.removeRow(r);
        }
        removedCount++;
        if (tableWasRemoved) break;
        continue;
      }

      // إذا كانت عدة مواد داخل الصف نفسه، نعالج كل خلية بصورة مستقلة.
      for (var c = 0; c < row.getNumCells(); c++) {
        removedCount += removeExcludedSectionsFromContainer_(
          row.getCell(c),
          excludedLookup
        );
      }
    }
  }

  // ثانياً نحذف كتل المواد التي تظهر كفقرات متتابعة في الجسم أو داخل خلية.
  removedCount += removeDirectSubjectBlocks_(container, excludedLookup);
  return removedCount;
}

/**
 * يحذف العناصر من عنوان المادة المستثناة وحتى العنصر السابق لعنوان المادة التالية.
 */
function removeDirectSubjectBlocks_(container, excludedLookup) {
  var headings = [];

  for (var i = 0; i < container.getNumChildren(); i++) {
    var child = container.getChild(i);
    var type = child.getType();
    if (type !== DocumentApp.ElementType.PARAGRAPH &&
        type !== DocumentApp.ElementType.LIST_ITEM) {
      continue;
    }

    var subject = getSubjectHeadingFromText_(child.getText());
    if (subject) headings.push({ index: i, subject: subject });
  }

  var removedCount = 0;
  for (var h = headings.length - 1; h >= 0; h--) {
    if (!excludedLookup[headings[h].subject]) continue;

    var startIndex = headings[h].index;
    var endIndex = h + 1 < headings.length
      ? headings[h + 1].index - 1
      : container.getNumChildren() - 1;

    // clear() يترك فقرة فارغة إلزامية عند الحاويات التي لا يجوز أن تكون بلا أبناء.
    if (startIndex === 0 && endIndex === container.getNumChildren() - 1 &&
        typeof container.clear === "function") {
      container.clear();
      removedCount++;
      continue;
    }

    for (var index = endIndex; index >= startIndex; index--) {
      container.removeChild(container.getChild(index));
    }
    removedCount++;
  }

  return removedCount;
}

/**
 * يجمع عناوين المواد المعروفة من أي عنصر، بما في ذلك الجداول والخلايا.
 */
function collectSubjectHeadings_(element) {
  var result = [];
  if (!element) return result;

  var type = typeof element.getType === "function" ? element.getType() : null;
  if (type === DocumentApp.ElementType.PARAGRAPH ||
      type === DocumentApp.ElementType.LIST_ITEM) {
    var subject = getSubjectHeadingFromText_(element.getText());
    if (subject) result.push(subject);
    return result;
  }

  if (typeof element.getNumChildren !== "function") return result;

  for (var i = 0; i < element.getNumChildren(); i++) {
    var childHeadings = collectSubjectHeadings_(element.getChild(i));
    for (var j = 0; j < childHeadings.length; j++) {
      result.push(childHeadings[j]);
    }
  }

  return result;
}

/**
 * يعتبر النص عنوان مادة فقط إذا كان سطراً مستقلاً، وليس وسم استدعاء.
 */
function getSubjectHeadingFromText_(text) {
  text = String(text || "");
  if (text.indexOf("<<") !== -1 || text.indexOf(">>") !== -1) return "";

  var candidate = normalizeSubjectHeading_(text);
  candidate = candidate.replace(/^برنامج\s+/, "");

  for (var i = 0; i < SUBJECTS.length; i++) {
    if (candidate === normalizeSubjectHeading_(SUBJECTS[i])) {
      return SUBJECTS[i];
    }
  }

  return "";
}

function normalizeSubjectHeading_(text) {
  return String(text || "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/^[\s\u2022\u25CF\u25AA\u25E6\u2043\u2219\-–—*]+/, "")
    .replace(/[\s:：؛،,.!?؟]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings_(values) {
  var lookup = {};
  var result = [];
  for (var i = 0; i < values.length; i++) {
    if (!lookup[values[i]]) {
      lookup[values[i]] = true;
      result.push(values[i]);
    }
  }
  return result;
}

function updateMonthlyPlanForAPI_(targetMonth, sourceSnapshot) {
  var source = sourceSnapshot || readPlanSource_();
  var targetMonthFull = normalizePlanMonthForQuery_(targetMonth);
  preflightPlanGeneration_(targetMonthFull, source);
  validateCurriculumTemplate_();
  var collected = collectPlanRows_(source, targetMonthFull, {});
  var filled = collected.filledByKey;
  for (var grade in GRADE_DOCS) {
    var doc = DocumentApp.openById(GRADE_DOCS[grade]);
    replaceLiteralInPrimarySections_(doc, "<<الشهر>>", targetMonthFull);
    replaceLiteralInPrimarySections_(doc, "<<الصف>>", grade);
    for (var key in filled) {
      var item = filled[key];
      if (item.grade !== grade) continue;
      replaceLiteralInPrimarySections_(doc,
        "<<" + item.subject + "_" + item.week + ">>", item.activity);
    }
    doc.saveAndClose();
  }
}

function cleanEmptyPlaceholdersAPI_() {
  var errors = [];

  for (var grade in GRADE_DOCS) {
    try {
      var doc = DocumentApp.openById(GRADE_DOCS[grade]);
      for (var s = 0; s < SUBJECTS.length; s++) {
        for (var w = 0; w < WEEKS.length; w++) {
          replaceLiteralInPrimarySections_(
            doc,
            "<<" + SUBJECTS[s] + "_" + WEEKS[w] + ">>",
            ""
          );
        }
      }
      doc.saveAndClose();
    } catch (e) {
      errors.push(grade + ": " + (e.message || e));
      console.error(e && e.stack ? e.stack : e);
    }
  }

  if (errors.length > 0) {
    throw new Error("فشل تنظيف بعض الملفات:\n" + errors.join("\n"));
  }
}

// ==========================================
// 8. أدوات التحقق والاستبدال الآمن
// ==========================================

function validateRequiredColumns_(headers) {
  var required = ["الشهر", "الصف", "المادة", "الأسبوع", "تفاصيل الأنشطة"];
  var missing = [];

  for (var i = 0; i < required.length; i++) {
    if (headers.indexOf(required[i]) === -1) missing.push(required[i]);
  }

  if (missing.length > 0) {
    throw new Error("أعمدة ناقصة في الصف الأول من الشيت: " + missing.join("، "));
  }
}

function replaceLiteralInPrimarySections_(doc, literalText, replacementText) {
  var parts = getPrimaryDocumentParts_(doc);
  var sections = [parts.body, parts.header, parts.footer];
  var searchPattern = escapeRegexForDocs_(literalText);
  var replacement = String(replacementText === null || replacementText === undefined ? "" : replacementText);

  for (var i = 0; i < sections.length; i++) {
    if (sections[i]) sections[i].replaceText(searchPattern, replacement);
  }
}

function escapeRegexForDocs_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
