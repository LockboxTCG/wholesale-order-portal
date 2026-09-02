"use strict";

// Validation-only: reads back state/email-threads/_dryrun.json (written by
// generator/write-dryrun-state.js and committed by the workflow) using the
// exact same read + reminder-building logic as the real
// send-reminder-emails.js, then sends the reminder threaded. Proves the
// write -> commit -> push -> read-back -> threaded-reply pipeline works
// for real, without touching the customer directory or a real month's
// state file.

const fs = require("fs");
const path = require("path");

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");
const { buildReminderSubject, buildReminderBody } = require("./lib/reminderEmail");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "state", "email-threads", "_dryrun.json");
const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://wholesale.lockboxtcg.com";

async function main() {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(
      `${STATE_PATH} does not exist — run generator/write-dryrun-state.js (and commit it) first.`
    );
  }
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const slug = Object.keys(state)[0];
  const entry = state[slug];
  if (!entry) throw new Error(`${STATE_PATH} has no entries.`);

  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const url = `${SITE_ORIGIN}/c/${slug}/`;
  const firstName = entry.contactFirstName || "there";
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });

  const raw = buildRawEmail({
    to: entry.contactEmail,
    from,
    subject: buildReminderSubject(entry.subject),
    body: buildReminderBody({ firstName, monthLabel, url, businessName: entry.businessName })
  });

  const sent = await sendEmail({ accessToken, raw, threadId: entry.threadId });
  console.log(`Replied to ${entry.contactEmail} (Gmail id ${sent.id}, threadId ${sent.threadId}).`);
  console.log(
    sent.threadId === entry.threadId
      ? "Roundtrip validated: state read back from a real committed file threaded correctly."
      : `WARNING: reply landed in a different thread (${sent.threadId}) than the committed entry (${entry.threadId}).`
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
