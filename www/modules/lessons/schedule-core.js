(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GharsCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MINUTES_PER_DAY = 1440;
  const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
  const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function isValidTime(value) {
    return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  }

  function timeToMinutes(value) {
    if (!isValidTime(value)) return NaN;
    const [hour, minute] = value.split(':').map(Number);
    return (hour * 60) + minute;
  }

  function formatTime(value) {
    const total = timeToMinutes(value);
    if (!Number.isFinite(total)) return '--:--';
    const hour24 = Math.floor(total / 60);
    const minute = total % 60;
    const period = hour24 >= 12 ? 'م' : 'ص';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
  }

  function normalizeLesson(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const subject = String(raw.subject || raw.name || '').trim();
    const grade = String(raw.grade || '').trim();
    const day = Number(raw.day);
    const reminder = Number(raw.reminder);
    const startTime = String(raw.startTime || '');
    const endTime = String(raw.endTime || '');
    if (!subject || !grade || !Number.isInteger(day) || day < 0 || day > 6) return null;
    if (!isValidTime(startTime) || !isValidTime(endTime)) return null;
    return {
      id: String(raw.id || Date.now()), subject, grade, day: String(day), startTime, endTime,
      reminder: String(Number.isSafeInteger(reminder) && reminder >= 0 ? reminder : 5)
    };
  }

  function validateLesson(lesson) {
    if (!lesson.subject.trim()) return 'اكتب اسم المادة أو البرنامج.';
    if (!lesson.grade.trim()) return 'اكتب اسم الصف أو الشعبة.';
    if (!isValidTime(lesson.startTime) || !isValidTime(lesson.endTime)) return 'اختر وقت البداية والنهاية.';
    if (timeToMinutes(lesson.endTime) <= timeToMinutes(lesson.startTime)) return 'يجب أن يكون وقت النهاية بعد وقت البداية.';
    const reminder = Number(lesson.reminder);
    if (!Number.isSafeInteger(reminder) || reminder < 0) return 'مدة التنبيه يجب أن تكون عددًا صحيحًا موجبًا أو صفرًا.';
    const day = Number(lesson.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return 'اختر يومًا صحيحًا.';
    return '';
  }

  function jsDayToPluginWeekday(jsDay) {
    const day = Number(jsDay);
    if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Invalid weekday');
    return day === 0 ? 7 : day;
  }

  function weeklyTriggerParts(jsDay, time, minutesBefore) {
    const pluginWeekday = jsDayToPluginWeekday(jsDay);
    const base = ((pluginWeekday - 1) * MINUTES_PER_DAY) + timeToMinutes(time);
    const offset = Number(minutesBefore);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isFinite(base)) throw new Error('Invalid reminder');
    const wrapped = ((base - (offset % MINUTES_PER_WEEK)) % MINUTES_PER_WEEK + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    return { weekday: Math.floor(wrapped / MINUTES_PER_DAY) + 1, hour: Math.floor((wrapped % MINUTES_PER_DAY) / 60), minute: wrapped % 60 };
  }

  function nextOccurrence(lesson, fromDate) {
    const from = new Date(fromDate || Date.now());
    const target = new Date(from);
    const targetDay = Number(lesson.day);
    const [hour, minute] = lesson.startTime.split(':').map(Number);
    target.setDate(from.getDate() + ((targetDay + 7 - from.getDay()) % 7));
    target.setHours(hour, minute, 0, 0);
    if (target <= from) target.setDate(target.getDate() + 7);
    return target;
  }

  return { DAYS_AR, isValidTime, timeToMinutes, formatTime, normalizeLesson, validateLesson, jsDayToPluginWeekday, weeklyTriggerParts, nextOccurrence };
}));
