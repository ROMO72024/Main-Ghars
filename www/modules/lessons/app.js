(function () {
  'use strict';
  const STORAGE_KEY = 'gharsClasses';
  const CHANNEL_ID = 'ghars_class_alerts_v2';
  const core = window.GharsCore;
  let classes = [];
  let currentDay = new Date().getDay();
  let initialized = false;
  let toastTimer = null;
  const $ = (id) => document.getElementById(id);

  function isNative() {
    return typeof window.cordova !== 'undefined' && window.cordova.plugins &&
      window.cordova.plugins.notification && window.cordova.plugins.notification.local;
  }

  function loadClasses() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      classes = Array.isArray(stored) ? stored.map(core.normalizeLesson).filter(Boolean) : [];
      persistClasses();
    } catch (error) {
      classes = [];
      console.error('تعذر قراءة الحصص المحفوظة', error);
    }
  }

  function persistClasses() { localStorage.setItem(STORAGE_KEY, JSON.stringify(classes)); }

  function bindEvents() {
    ['headerAddBtn', 'mainAddBtn', 'floatingAddBtn'].forEach((id) => $(id).addEventListener('click', () => openModal()));
    $('testNotificationBtn').addEventListener('click', testNotification);
    $('exactAlarmBtn').addEventListener('click', openExactAlarmSettings);
    $('closeModalBtn').addEventListener('click', closeModal);
    $('cancelModalBtn').addEventListener('click', closeModal);
    $('modalBackdrop').addEventListener('click', closeModal);
    $('classForm').addEventListener('submit', saveClass);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('classModal').classList.contains('open')) closeModal();
    });
  }

  function render() { renderHeader(); renderDays(); renderClasses(); }

  function renderHeader() {
    const now = new Date();
    $('todayCount').textContent = String(classes.filter((lesson) => Number(lesson.day) === now.getDay()).length);
    $('classTotal').textContent = `${classes.length} حصة`;
    $('todayDate').textContent = new Intl.DateTimeFormat('ar', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    if (!classes.length) {
      $('nextClassText').textContent = 'أضف حصصك وسيعمل التنبيه تلقائيًا دون إنترنت.';
      return;
    }
    const upcoming = classes.map((lesson) => ({ lesson, date: core.nextOccurrence(lesson, now) })).sort((a, b) => a.date - b.date)[0];
    const dayText = upcoming.date.getDay() === now.getDay() ? 'اليوم' : core.DAYS_AR[upcoming.date.getDay()];
    $('nextClassText').textContent = `الحصة القادمة: ${upcoming.lesson.subject} • ${dayText} ${core.formatTime(upcoming.lesson.startTime)}`;
  }

  function renderDays() {
    const nav = $('daysNav');
    nav.replaceChildren();
    const today = new Date().getDay();
    core.DAYS_AR.forEach((day, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `day-tab${index === currentDay ? ' active' : ''}${index === today ? ' today' : ''}`;
      button.textContent = day;
      button.setAttribute('aria-pressed', String(index === currentDay));
      button.addEventListener('click', () => { currentDay = index; renderDays(); renderClasses(); });
      nav.appendChild(button);
      if (index === currentDay) requestAnimationFrame(() => button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
    });
  }

  function renderClasses() {
    const list = $('classesList');
    list.replaceChildren();
    const dayClasses = classes.filter((lesson) => Number(lesson.day) === currentDay)
      .sort((a, b) => core.timeToMinutes(a.startTime) - core.timeToMinutes(b.startTime));
    if (!dayClasses.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const image = document.createElement('img');
      image.src = 'icon.png'; image.alt = '';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `لا توجد حصص يوم ${core.DAYS_AR[currentDay]}`;
      const text = document.createElement('p');
      text.textContent = 'اضغط على إضافة حصة وحدد وقت البداية والنهاية ومدة التنبيه.';
      copy.append(title, text); empty.append(image, copy); list.appendChild(empty);
      return;
    }
    dayClasses.forEach((lesson) => list.appendChild(createClassCard(lesson)));
  }

  function createClassCard(lesson) {
    const card = document.createElement('article'); card.className = 'class-card';
    const time = document.createElement('div'); time.className = 'time-badge';
    const start = document.createElement('strong'); start.textContent = core.formatTime(lesson.startTime);
    const end = document.createElement('small'); end.textContent = `حتى ${core.formatTime(lesson.endTime)}`;
    time.append(start, end);

    const info = document.createElement('div'); info.className = 'class-info';
    const subject = document.createElement('h3'); subject.textContent = lesson.subject;
    const grade = document.createElement('p'); grade.textContent = `الصف: ${lesson.grade}`;
    const reminder = document.createElement('p'); reminder.className = 'reminder-line';
    reminder.textContent = Number(lesson.reminder) === 0 ? '🔔 تنبيه عند بداية الحصة' : `🔔 قبل الحصة بـ ${lesson.reminder} دقيقة`;
    info.append(subject, grade, reminder);

    const actions = document.createElement('div'); actions.className = 'card-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'edit-card'; edit.textContent = '✎'; edit.setAttribute('aria-label', `تعديل ${lesson.subject}`);
    edit.addEventListener('click', () => editClass(lesson.id));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'delete-card'; remove.textContent = '⌫'; remove.setAttribute('aria-label', `حذف ${lesson.subject}`);
    remove.addEventListener('click', () => deleteClass(lesson.id));
    actions.append(edit, remove); card.append(time, info, actions); return card;
  }

  function openModal(lesson) {
    const editing = Boolean(lesson);
    $('classId').value = editing ? lesson.id : '';
    $('subjectName').value = editing ? lesson.subject : '';
    $('gradeName').value = editing ? lesson.grade : '';
    $('classDay').value = editing ? lesson.day : String(currentDay);
    $('startTime').value = editing ? lesson.startTime : '11:40';
    $('endTime').value = editing ? lesson.endTime : '11:55';
    $('reminderMins').value = editing ? lesson.reminder : '5';
    $('modalTitle').textContent = editing ? 'تعديل الحصة' : 'إضافة حصة جديدة';
    $('formError').textContent = '';
    $('classModal').classList.add('open'); $('classModal').setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
    setTimeout(() => $('subjectName').focus(), 80);
  }

  function closeModal() {
    $('classModal').classList.remove('open'); $('classModal').setAttribute('aria-hidden', 'true'); document.body.classList.remove('modal-open');
  }

  function saveClass(event) {
    event.preventDefault();
    const lesson = {
      id: $('classId').value || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      subject: $('subjectName').value.trim(), grade: $('gradeName').value.trim(), day: $('classDay').value,
      startTime: $('startTime').value, endTime: $('endTime').value, reminder: $('reminderMins').value
    };
    const error = core.validateLesson(lesson);
    if (error) { $('formError').textContent = error; return; }
    const normalized = core.normalizeLesson(lesson);
    const existingIndex = classes.findIndex((item) => item.id === normalized.id);
    if (existingIndex >= 0) classes.splice(existingIndex, 1, normalized); else classes.push(normalized);
    currentDay = Number(normalized.day);
    persistClasses(); closeModal(); render(); scheduleNativeNotifications();
    showToast(existingIndex >= 0 ? 'تم تعديل الحصة وتحديث التنبيهات.' : 'تم حفظ الحصة وجدولة التنبيهات.');
  }

  function editClass(id) { const lesson = classes.find((item) => item.id === id); if (lesson) openModal(lesson); }
  function deleteClass(id) {
    const lesson = classes.find((item) => item.id === id);
    if (!lesson || !window.confirm(`حذف حصة ${lesson.subject}؟`)) return;
    classes = classes.filter((item) => item.id !== id); persistClasses(); render(); scheduleNativeNotifications(); showToast('تم حذف الحصة وتحديث التنبيهات.');
  }

  function notificationOptions(id, title, text, trigger) {
    return {
      id, title, text, trigger, sound: 'default', launch: true,
      androidChannelId: CHANNEL_ID, androidChannelName: 'تنبيهات حصص غرس',
      androidChannelDescription: 'تنبيه مسبق وتنبيه عند بدء الحصة الدراسية',
      androidChannelImportance: 'IMPORTANCE_HIGH', androidChannelEnableVibration: true, androidChannelEnableLights: true,
      androidColor: '#83145f', androidLargeIcon: 'www/icon.png', androidAllowWhileIdle: true, androidWakeUpScreen: true, iOSForeground: true
    };
  }

  function buildNotificationSchedule() {
    const notifications = []; let id = 100;
    classes.forEach((lesson) => {
      const className = `${lesson.subject} — ${lesson.grade}`;
      const startTrigger = core.weeklyTriggerParts(Number(lesson.day), lesson.startTime, 0);
      const reminderMinutes = Number(lesson.reminder);
      if (reminderMinutes > 0) {
        const reminderTrigger = core.weeklyTriggerParts(Number(lesson.day), lesson.startTime, reminderMinutes);
        notifications.push(notificationOptions(id++, 'اقترب موعد الحصة ⏳', `متبقي ${reminderMinutes} دقيقة على ${className}`, { every: reminderTrigger }));
      }
      notifications.push(notificationOptions(id++, 'بدأت الحصة الآن 🔔', `${className}\n${core.formatTime(lesson.startTime)} – ${core.formatTime(lesson.endTime)}`, { every: startTrigger }));
    });
    return notifications;
  }

  function scheduleNativeNotifications() {
    if (!isNative()) return;
    const local = window.cordova.plugins.notification.local;
    local.cancelAll(() => {
      const notifications = buildNotificationSchedule();
      if (notifications.length) local.schedule(notifications);
      updatePermissionStatus();
    });
  }

  function requestNotificationPermission() {
    if (!isNative()) { setStatus('معاينة المتصفح', 'الصوت والجدولة يعملان داخل تطبيق Android المثبّت.', false); return; }
    const local = window.cordova.plugins.notification.local;
    local.hasPermission((granted) => {
      if (granted) { createNotificationChannel(); scheduleNativeNotifications(); }
      else local.requestPermission((allowed) => {
        if (allowed) { createNotificationChannel(); scheduleNativeNotifications(); }
        else setStatus('الإشعارات غير مفعّلة', 'فعّل إذن الإشعارات من إعدادات الهاتف.', true);
      });
    });
  }

  function createNotificationChannel() {
    if (!isNative()) return;
    const local = window.cordova.plugins.notification.local;
    if (typeof local.createChannel !== 'function') return;
    local.createChannel({
      androidChannelId: CHANNEL_ID, androidChannelName: 'تنبيهات حصص غرس',
      androidChannelDescription: 'صوت واهتزاز لمواعيد الحصص الدراسية',
      androidChannelImportance: 'IMPORTANCE_HIGH', androidChannelEnableVibration: true, androidChannelEnableLights: true, sound: 'default'
    }, updatePermissionStatus);
  }

  function updatePermissionStatus() {
    if (!isNative()) return;
    const local = window.cordova.plugins.notification.local;
    local.hasPermission((granted) => {
      if (!granted) { setStatus('الإشعارات غير مفعّلة', 'فعّل إذن الإشعارات حتى تصلك تنبيهات الحصص.', true); return; }
      if (typeof local.canScheduleExactAlarms === 'function') {
        local.canScheduleExactAlarms((exact) => {
          if (exact) setStatus('التنبيهات مفعّلة بدقة', 'الصوت والاهتزاز يعملان حتى مع قفل الشاشة.', false);
          else setStatus('التنبيهات مفعّلة', 'اسمح بالمنبّهات الدقيقة لتصل في اللحظة المحددة.', true, true);
        }, () => setStatus('التنبيهات مفعّلة', 'سيستخدم التطبيق أقرب وقت يسمح به النظام.', false));
      } else setStatus('التنبيهات مفعّلة', 'تمت جدولة حصصك بصوت واهتزاز.', false);
    });
  }

  function setStatus(title, text, attention, showExactButton) {
    $('statusTitle').textContent = title; $('statusText').textContent = text;
    $('notificationStatus').classList.toggle('needs-attention', Boolean(attention));
    $('exactAlarmBtn').classList.toggle('hidden', !showExactButton);
  }

  function openExactAlarmSettings() {
    if (!isNative()) return;
    const local = window.cordova.plugins.notification.local;
    if (typeof local.openAlarmSettings === 'function') local.openAlarmSettings();
    else showToast('افتح إعدادات التطبيق ثم فعّل المنبّهات والتذكيرات.', true);
  }

  function testNotification() {
    if (!isNative()) { showToast('تجربة الصوت متاحة داخل تطبيق Android بعد تثبيت APK.', true); return; }
    const local = window.cordova.plugins.notification.local;
    local.hasPermission((granted) => {
      if (!granted) { requestNotificationPermission(); showToast('وافق على إذن الإشعارات ثم جرّب مرة أخرى.', true); return; }
      local.schedule(notificationOptions(99, 'منبّه غرس يعمل بنجاح 🔔', 'ستصلك حصصك بصوت الجهاز والاهتزاز في الوقت المحدد.', { in: 2, unit: 'second' }));
      showToast('سيصدر صوت التجربة خلال ثانيتين.');
    });
  }

  function showToast(message, isError) {
    const toast = $('toast'); toast.textContent = message; toast.classList.toggle('error', Boolean(isError)); toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function boot() {
    if (initialized) return;
    initialized = true; loadClasses(); bindEvents(); render(); requestNotificationPermission();
  }

  document.addEventListener('deviceready', boot, false);
  document.addEventListener('resume', () => { if (initialized) { updatePermissionStatus(); scheduleNativeNotifications(); } }, false);
  document.addEventListener('DOMContentLoaded', () => { if (typeof window.cordova === 'undefined') boot(); });
}());
