(function () {
  "use strict";

  window.GHARS_CONFIG = Object.freeze({
    appName: "غرس الرقمي",
    attendanceApi: "https://script.google.com/macros/s/AKfycbyLo60SsdFtB8Sttx347Jn26erlDINiishZiDYHMsbRO_paRJUiVgCSR4-Kl0UWDjzQyg/exec",
    monthlyPlansUrl: "",
    aiGamesUrl: "https://ghars-ai-games.romo7iv.chatgpt.site/",
    tasksUrl: "",
    modules: Object.freeze({
      attendance: Object.freeze({ local: "modules/attendance/index.html?portal=1", online: false }),
      lessons: Object.freeze({ local: "modules/lessons/index.html?portal=1", online: false }),
      games: Object.freeze({ external: "https://ghars-ai-games.romo7iv.chatgpt.site/", online: true }),
      plans: Object.freeze({ external: "", online: true }),
      tasks: Object.freeze({ external: "", online: true })
    })
  });
}());
