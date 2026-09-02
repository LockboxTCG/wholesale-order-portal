"use strict";

// Validation-only dry run: writes a real state/email-threads/_dryrun.json
// entry so the "Commit thread state" workflow step and the reminder
// script's state-read path can both be exercised for real, without ever
// touching the customer directory or emailing a real customer.
//
// "_dryrun" can never collide with a real month's state file, which is
// always named YYYY-MM.json (see monthKey() in send-monthly-emails.js).
// Cleaned up by generator/cleanup-dryrun-state.js in the same workflow run.

const fs = require("fs");
const path = require("path");

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");
const { rewriteEmailBody } = require("./lib/rewriteEmail");
const { buildMonthlySubject, buildTokenizedBody, fillTokens } = require("./lib/monthlyEmail");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "state", "email-threads", "_dryrun.json");
const SLUG = "dryrun-test-customer";

async function main() {
  const to = process.env.TEST_EMAIL_TO || "management@lockboxtcg.com";
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });

  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const subject = buildMonthlySubject(monthLabel);
  const tokenizedBody = buildTokenizedBody();
  const rewritten = await rewriteEmailBody(tokenizedBody, process.env.ANTHROPIC_API_KEY);
  const bodyTemplate = rewritten || tokenizedBody;

  const contactFirstName = "Dryrun";
  const businessName = "Dry Run Validation Co";

  const body = fillTokens(bodyTemplate, {
    name: contactFirstName,
    month: monthLabel,
    link: `https://wholesale.lockboxtcg.com/c/${SLUG}/`,
    business: businessName
  });

  const raw = buildRawEmail({ to, from, subject, body });
  const sent = await sendEmail({ accessToken, raw });

  const state = {
    [SLUG]: {
      businessName,
      contactFirstName,
      contactEmail: to,
      threadId: sent.threadId,
      subject
    }
  };

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
  console.log(`Wrote ${STATE_PATH} (threadId ${sent.threadId}).`);
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
