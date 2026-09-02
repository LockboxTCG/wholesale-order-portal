"use strict";

// One-off test send: emails the exact monthly template (base, or the
// AI-rewritten version when ANTHROPIC_API_KEY is set) to a single address
// using a fake customer, so it can be inspected in a real Gmail inbox.
//
// Deliberately bypasses the Oct 1 launch cutoff and never touches the
// customer directory or state/email-threads/ — this can't affect or
// duplicate a real monthly send.

const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");
const { rewriteEmailBody } = require("./lib/rewriteEmail");
const { buildMonthlySubject, buildTokenizedBody, fillTokens } = require("./lib/monthlyEmail");

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
  console.log(
    rewritten
      ? "Using an AI-rewritten email template for this test send."
      : "Using the base email template (rewrite unavailable, invalid, or ANTHROPIC_API_KEY not set)."
  );

  const body = fillTokens(bodyTemplate, {
    name: process.env.TEST_NAME || "Alex",
    month: monthLabel,
    link: "https://wholesale.lockboxtcg.com/c/preview0000/",
    business: process.env.TEST_BUSINESS || "Sample Card Shop"
  });

  const raw = buildRawEmail({ to, from, subject, body });
  const sent = await sendEmail({ accessToken, raw });
  console.log(`Test email sent to ${to} (Gmail id ${sent.id}, threadId ${sent.threadId}).`);
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
