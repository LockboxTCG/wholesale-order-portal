"use strict";

const crypto = require("crypto");
const { customerSlug, slugify } = require("./slug");

// Asks the portal's server who has ordered or has a draft order in the last N
// days (api/recent-activity.js) and matches that against the customer
// directory. The monthly send skips those customers: they're already in
// touch, so the "here's this month's page" email is noise.

const WINDOW_DAYS = 14;

function authToken(clientSecret) {
  return crypto.createHmac("sha256", clientSecret).update("recent-activity").digest("hex");
}

async function fetchRecentActivity({ siteOrigin, clientSecret, days = WINDOW_DAYS, attempts = 3, fetchImpl = fetch, sleep }) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetchImpl(`${siteOrigin}/api/recent-activity?days=${days}`, {
        headers: { Authorization: `Bearer ${authToken(clientSecret)}` }
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok && json.ok && Array.isArray(json.activity)) return json;
      throw new Error(`HTTP ${r.status} ${json.error || ""}`.trim());
    } catch (err) {
      lastErr = err;
      if (i < attempts) await wait(5000 * i);
    }
  }
  throw new Error(`Could not check recent orders (${lastErr.message})`);
}

// Returns the activity rows that belong to this customer: same portal slug on
// the draft's note, same email as the directory contact, or same company name.
function matchActivity(customer, activity, secret) {
  const slug = customerSlug(customer.businessName, secret);
  const email = String(customer.contactEmail || "").trim().toLowerCase();
  const name = slugify(customer.businessName);
  return activity.filter(
    (a) =>
      (a.slug && a.slug === slug) ||
      (email && a.emails.includes(email)) ||
      (name && a.company && slugify(a.company) === name)
  );
}

// { send: [...customers], skipped: [{ customer, rows }] }
function splitByActivity(customers, activity, secret) {
  const send = [];
  const skipped = [];
  for (const c of customers) {
    const rows = matchActivity(c, activity, secret);
    if (rows.length > 0) skipped.push({ customer: c, rows });
    else send.push(c);
  }
  return { send, skipped };
}

function describeRows(rows) {
  return rows.map((r) => `${r.ref} ${r.status.toLowerCase().replace(/_/g, " ")} ${String(r.at).slice(0, 10)}`).join(", ");
}

module.exports = { WINDOW_DAYS, authToken, fetchRecentActivity, matchActivity, splitByActivity, describeRows };
