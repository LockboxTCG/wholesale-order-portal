"use strict";

// Sends a reminder reply, in the same Gmail thread as the original monthly
// email, for the current month. Run on the 15th. Reads the state file
// send-monthly-emails.js wrote on the 1st; customers with no entry there
// (e.g. added to the directory after the 1st) are skipped, not emailed a
// standalone reminder.

const fs = require("fs");
const path = require("path");

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");

const ROOT = path.join(__dirname, "..");

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://wholesale.lockboxtcg.com";
  const PORTAL_SLUG_SECRET = requireEnv("PORTAL_SLUG_SECRET");

  const now = new Date();
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

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  for (const slug of slugs) {
    const entry = state[slug];
    const url = `${SITE_ORIGIN}/c/${slug}/`;

    const raw = buildRawEmail({
      to: entry.contactEmail,
      from,
      subject: `Re: ${entry.subject}`,
      body: [
        "Just a reminder — your wholesale ordering page is still open:",
        url,
        "",
        "— LockboxTCG"
      ].join("\n")
    });

    try {
      await sendEmail({ accessToken, raw, threadId: entry.threadId });
      console.log(`Reminded ${entry.businessName} <${entry.contactEmail}>`);
    } catch (err) {
      console.error(`Failed to remind "${entry.businessName}" <${entry.contactEmail}>: ${err.message}`);
    }
  }
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
