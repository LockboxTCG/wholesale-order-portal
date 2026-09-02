"use strict";

// The 15th's reminder subject + body, shared by send-reminder-emails.js
// (the real send) and send-test-reminder.js (a local test that replies
// into a real thread) so the test can never drift from what actually sends.

function buildReminderSubject(originalSubject) {
  return `Re: ${originalSubject}`;
}

function buildReminderBody({ firstName, monthLabel, url, businessName }) {
  return [
    `Hey ${firstName}, quick note: your ${monthLabel} order page is still open if you haven't placed your order yet:`,
    "",
    url,
    "",
    `No rush if ${businessName} is already set for the month.`,
    "",
    "Thanks,",
    "LockboxTCG"
  ].join("\n");
}

module.exports = { buildReminderSubject, buildReminderBody };
