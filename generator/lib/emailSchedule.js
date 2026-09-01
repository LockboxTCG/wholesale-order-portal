"use strict";

// Hard cutoff: the monthly customer email flow must not send to anyone
// before this date, regardless of the cron schedule or an accidental
// manual workflow_dispatch. Update/remove once the real launch has happened.
const FIRST_SEND_DATE = new Date("2026-10-01T00:00:00Z");

function beforeFirstSend(now = new Date()) {
  return now < FIRST_SEND_DATE;
}

module.exports = { FIRST_SEND_DATE, beforeFirstSend };
