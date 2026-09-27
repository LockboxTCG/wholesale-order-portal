"use strict";

// Send/remind scheduling: normally "first Monday of the month" (send) and
// "third Monday of the month" (remind). Both .github/workflows/*.yml cron
// on every Monday and rely on isSendDay()/isRemindDay() here to decide
// whether today is actually the day, since cron itself can't express
// "Nth weekday of the month" - a day 1-7 or 15-21 range always contains
// exactly one Monday, which is the standard idiom for this.
//
// A small set of one-time exceptions handles the transition onto this
// schedule for this cycle only, explicitly agreed with the business
// (first send Sept 28 2026, its reminder exactly 2 weeks later on Oct 12
// 2026 - both fall outside the normal day-of-month ranges above, so they
// need an explicit override - and the regular October 5/19 dates they
// replace are explicitly suppressed so the month doesn't double-send).
// Every month from November 2026 onward follows the plain recurring rule
// with no special-casing needed.
//
// TRANSITION_FLOOR is a hard safety net independent of all the date-range
// logic above: nothing fires before it, no matter what.

const TRANSITION_FLOOR = new Date("2026-09-28T00:00:00Z");

const ONE_TIME_SEND_DATES = ["2026-09-28"];
const ONE_TIME_REMIND_DATES = ["2026-10-12"];
const SUPERSEDED_DATES = ["2026-10-05", "2026-10-19"];

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isMonday(date) {
  return date.getUTCDay() === 1;
}

function isSendDay(date = new Date()) {
  if (date < TRANSITION_FLOOR) return false;
  const key = dateKey(date);
  if (ONE_TIME_SEND_DATES.includes(key)) return true;
  if (SUPERSEDED_DATES.includes(key)) return false;
  const day = date.getUTCDate();
  return isMonday(date) && day >= 1 && day <= 7;
}

function isRemindDay(date = new Date()) {
  if (date < TRANSITION_FLOOR) return false;
  const key = dateKey(date);
  if (ONE_TIME_REMIND_DATES.includes(key)) return true;
  if (SUPERSEDED_DATES.includes(key)) return false;
  const day = date.getUTCDate();
  return isMonday(date) && day >= 15 && day <= 21;
}

module.exports = { isSendDay, isRemindDay, TRANSITION_FLOOR };
