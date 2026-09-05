'use strict';
const assert = require('node:assert/strict');
const core = require('../schedule-core.js');

assert.equal(core.timeToMinutes('11:40'), 700);
assert.equal(core.formatTime('11:40'), '11:40 ص');
assert.equal(core.formatTime('13:05'), '1:05 م');
assert.equal(core.validateLesson({ subject: 'عربي', grade: 'الأول', day: '5', startTime: '11:40', endTime: '11:55', reminder: '5' }), '');
assert.match(core.validateLesson({ subject: 'عربي', grade: 'الأول', day: '5', startTime: '11:55', endTime: '11:40', reminder: '5' }), /النهاية/);
assert.deepEqual(core.weeklyTriggerParts(5, '11:40', 5), { weekday: 5, hour: 11, minute: 35 });
assert.deepEqual(core.weeklyTriggerParts(0, '00:30', 60), { weekday: 6, hour: 23, minute: 30 });
assert.deepEqual(core.normalizeLesson({ id: 1, name: 'رياضيات', grade: 'الثاني', day: 0, startTime: '08:00', endTime: '08:40', reminder: 5 }), {
  id: '1', subject: 'رياضيات', grade: 'الثاني', day: '0', startTime: '08:00', endTime: '08:40', reminder: '5'
});
console.log('All schedule-core tests passed.');
