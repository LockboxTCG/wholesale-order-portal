"use strict";

// Sends each customer their monthly ordering-page link. Run on the 1st of
// the month, an hour after generate.js has already redeployed the site with
// that month's pages (see .github/workflows/monthly-emails.yml).
//
// Records each sent message's Gmail threadId + exact subject line to
// state/email-threads/<YYYY-MM>.json, committed back to the repo — the
// reminder script on the 15th reads that file to reply into the same
// thread. Refuses to run twice for the same month (guards against an
// accidental double-send to every customer on a manual re-run) unless
// FORCE=1 is set.

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const { loadAuth, getGrid } = require("./lib/sheets");
const { parseCustomers } = require("./lib/parseCustomers");
const { customerSlug } = require("./lib/slug");
const { getAccessToken, buildRawEmail, sendEmail } = require("./lib/gmailSend");

const ROOT = path.join(__dirname, "..");

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const CUSTOMER_SHEET_ID = requireEnv("CUSTOMER_SHEET_ID");
  const PORTAL_SLUG_SECRET = requireEnv("PORTAL_SLUG_SECRET");
  const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://wholesale.lockboxtcg.com";

  const now = new Date();
  const key = monthKey(now);
  const statePath = path.join(ROOT, "state", "email-threads", `${key}.json`);

  if (fs.existsSync(statePath) && !process.env.FORCE) {
    throw new Error(
      `${statePath} already exists — monthly emails for ${key} appear to have already been sent. ` +
        "Set FORCE=1 to send again anyway (this will email every customer a second time)."
    );
  }

  const auth = loadAuth();
  const sheets = google.sheets({ version: "v4", auth });

  console.log("Fetching customer directory…");
  const customerGrid = await getGrid(sheets, CUSTOMER_SHEET_ID);
  const customers = parseCustomers(customerGrid);
  console.log(`Parsed ${customers.length} customers.`);

  const accessToken = await getAccessToken({
    clientId: requireEnv("GMAIL_CLIENT_ID"),
    clientSecret: requireEnv("GMAIL_CLIENT_SECRET"),
    refreshToken: requireEnv("GMAIL_REFRESH_TOKEN")
  });
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  const monthLabel = now.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const state = {};

  for (const c of customers) {
    if (!c.contactEmail) {
      console.warn(`Skipping "${c.businessName}" — no contact email on file.`);
      continue;
    }

    const slug = customerSlug(c.businessName, PORTAL_SLUG_SECRET);
    const url = `${SITE_ORIGIN}/c/${slug}/`;
    const greeting = c.contactFirstName ? `Hi ${c.contactFirstName},` : "Hi,";
    const subject = `Your ${monthLabel} LockboxTCG wholesale order is ready`;

    const raw = buildRawEmail({
      to: c.contactEmail,
      from,
      subject,
      body: [
        greeting,
        "",
        `Your ${monthLabel} wholesale ordering page is ready:`,
        url,
        "",
        "Let us know if you have any questions.",
        "",
        "— LockboxTCG"
      ].join("\n")
    });

    try {
      const sent = await sendEmail({ accessToken, raw });
      state[slug] = { businessName: c.businessName, contactEmail: c.contactEmail, threadId: sent.threadId, subject };
      console.log(`Sent to ${c.businessName} <${c.contactEmail}>`);
    } catch (err) {
      console.error(`Failed to send to "${c.businessName}" <${c.contactEmail}>: ${err.message}`);
    }
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  console.log(`\nWrote ${statePath} (${Object.keys(state).length} threads recorded).`);
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
