"use strict";

// Sends a reminder reply, in the same Gmail thread as the original monthly
// email, for the current month. Run on the third Monday of the month (see
// generator/lib/emailSchedule.js for the exact rule and this cycle's
// transition dates). Reads the state file send-monthly-emails.js wrote
// earlier that month; customers with no entry there (e.g. added to the
// directory after the send) are skipped, not emailed a standalone
// reminder.

const fs = require("fs");
const path = require("path");

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");
const { isRemindDay } = require("./lib/emailSchedule");
const { buildReminderSubject, buildReminderBody } = require("./lib/reminderEmail");
const { sendInBatches } = require("./lib/batchSend");

const ROOT = path.join(__dirname, "..");
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 10 * 60 * 1000;

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const now = new Date();

  if (!isRemindDay(now)) {
    console.log(
      `Today (${now.toISOString()}) is not a scheduled reminder day — nothing to remind, ` +
        "regardless of how this run was triggered. See generator/lib/emailSchedule.js for the rule."
    );
    return;
  }

  const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://wholesale.lockboxtcg.com";
  const PORTAL_SLUG_SECRET = requireEnv("PORTAL_SLUG_SECRET");

  const key = monthKey(now);
  const statePath = path.join(ROOT, "state", "email-threads", `${key}.json`);

  if (!fs.existsSync(statePath)) {
    throw new Error(
      `${statePath} does not exist — no monthly email was recorded as sent for ${key}, so there's nothing to remind.`
    );
  }
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const slugs = Object.keys(state);
  console.log(`Loaded ${slugs.length} threads from ${statePath}.`);

  const monthLabel = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  console.log(
    `Sending to ${slugs.length} customers in batches of ${BATCH_SIZE}, ${BATCH_DELAY_MS / 60000} min apart…`
  );

  await sendInBatches(slugs, {
    batchSize: BATCH_SIZE,
    delayMs: BATCH_DELAY_MS,
    sendOne: async (slug) => {
      const entry = state[slug];
      const url = `${SITE_ORIGIN}/c/${slug}/`;
      const firstName = entry.contactFirstName || "there";

      const raw = buildRawEmail({
        to: entry.contactEmail,
        from,
        subject: buildReminderSubject(entry.subject),
        body: buildReminderBody({ firstName, monthLabel, url, businessName: entry.businessName })
      });

      try {
        await sendEmail({ accessToken, raw, threadId: entry.threadId });
        console.log(`Reminded ${entry.businessName} <${entry.contactEmail}>`);
      } catch (err) {
        console.error(`Failed to remind "${entry.businessName}" <${entry.contactEmail}>: ${err.message}`);
      }
    }
  });
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
