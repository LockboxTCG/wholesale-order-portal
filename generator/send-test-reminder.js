"use strict";

// One-off test: replies into a real Gmail thread using the exact reminder
// template, so the actual thread-reply behavior can be inspected in Gmail
// (not just the copy).
//
// Defaults to replying into the thread created by the last `mode: test`
// run of send-test-email.js — override TEST_THREAD_ID / TEST_ORIGINAL_SUBJECT
// to target a different one.
//
// Deliberately bypasses the Oct 1 cutoff and never touches
// state/email-threads/ or the customer directory.

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");
const { buildMonthlySubject } = require("./lib/monthlyEmail");
const { buildReminderSubject, buildReminderBody } = require("./lib/reminderEmail");

async function main() {
  const to = process.env.TEST_EMAIL_TO || "management@lockboxtcg.com";
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";
  const threadId = process.env.TEST_THREAD_ID || "1a05f8d4fa5b00fa";

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });

  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const originalSubject = process.env.TEST_ORIGINAL_SUBJECT || buildMonthlySubject(monthLabel);
  const subject = buildReminderSubject(originalSubject);

  const body = buildReminderBody({
    firstName: process.env.TEST_NAME || "Alex",
    monthLabel,
    url: "https://wholesale.lockboxtcg.com/c/preview0000/",
    businessName: process.env.TEST_BUSINESS || "Sample Card Shop"
  });

  const raw = buildRawEmail({ to, from, subject, body });
  const sent = await sendEmail({ accessToken, raw, threadId });
  console.log(`Test reminder sent to ${to} (Gmail id ${sent.id}, threadId ${sent.threadId}).`);
  console.log(
    sent.threadId === threadId
      ? "Threaded correctly — same threadId as the original."
      : `WARNING: reply landed in a different thread (${sent.threadId}) than requested (${threadId}).`
  );
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
