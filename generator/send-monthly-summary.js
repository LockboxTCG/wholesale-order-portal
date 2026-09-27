"use strict";

// Posts a Slack digest of last month's wholesale activity: how many
// orders came in, total volume, who ordered, and who on the current
// customer list didn't. Runs on the 1st of the month, summarizing the
// month that just ended.
//
// Draft orders are tagged "wholesale-portal" at creation time (see
// api/submit-order.js) so this can query them reliably via Shopify's
// search syntax instead of guessing from note text.

const { google } = require("googleapis");
const { loadAuth, getGrid } = require("./lib/sheets");
const { parseCustomers } = require("./lib/parseCustomers");
const { customerSlug } = require("./lib/slug");

const DRAFT_ORDERS_QUERY = `
  query draftOrders($query: String!, $after: String) {
    draftOrders(first: 100, after: $after, query: $query) {
      edges {
        node {
          name
          note2
          createdAt
          totalPriceSet { shopMoney { amount } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function previousMonthRange(date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { start, end };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function fmt(n) {
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchTaggedDraftOrders(shop, token, start, end) {
  const query = `tag:wholesale-portal AND created_at:>=${isoDate(start)} AND created_at:<${isoDate(end)}`;
  const orders = [];
  let after = null;

  while (true) {
    const res = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: DRAFT_ORDERS_QUERY, variables: { query, after } })
    });
    const data = await res.json();
    if (!res.ok || data.errors) {
      throw new Error("draftOrders query failed: " + JSON.stringify(data.errors || data));
    }
    const conn = data.data.draftOrders;
    for (const edge of conn.edges) orders.push(edge.node);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }

  return orders;
}

function extractSlugFromNote(note) {
  const m = String(note || "").match(/^Portal:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

async function main() {
  const shop = requireEnv("SHOPIFY_SHOP");
  const token = requireEnv("SHOPIFY_ACCESS_TOKEN");
  const webhookUrl = requireEnv("SLACK_WEBHOOK_URL");
  const CUSTOMER_SHEET_ID = requireEnv("CUSTOMER_SHEET_ID");
  const PORTAL_SLUG_SECRET = requireEnv("PORTAL_SLUG_SECRET");

  const { start, end } = previousMonthRange(new Date());
  const monthLabel = start.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

  console.log(`Summarizing ${monthLabel} (${isoDate(start)} to ${isoDate(end)})…`);

  const orders = await fetchTaggedDraftOrders(shop, token, start, end);
  console.log(`Found ${orders.length} tagged draft orders.`);

  const auth = loadAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const customerGrid = await getGrid(sheets, CUSTOMER_SHEET_ID);
  const customers = parseCustomers(customerGrid).filter((c) => c.contactEmail);

  const nameBySlug = new Map();
  for (const c of customers) {
    nameBySlug.set(customerSlug(c.businessName, PORTAL_SLUG_SECRET), c.businessName);
  }

  const orderedSlugs = new Set();
  let totalVolume = 0;
  const orderLines = [];

  for (const o of orders) {
    const slug = extractSlugFromNote(o.note2);
    const businessName = (slug && nameBySlug.get(slug)) || (o.note2 || "").split("\n")[0] || o.name;
    const amount = Number(o.totalPriceSet?.shopMoney?.amount) || 0;
    totalVolume += amount;
    if (slug) orderedSlugs.add(slug);
    orderLines.push(`  ${businessName}: ${fmt(amount)} (${o.name})`);
  }

  const notOrdered = customers.filter(
    (c) => !orderedSlugs.has(customerSlug(c.businessName, PORTAL_SLUG_SECRET))
  );

  const text = [
    `*${monthLabel} wholesale summary*`,
    `${orders.length} order${orders.length === 1 ? "" : "s"} from ${orderedSlugs.size} of ${customers.length} customers. Total volume: ${fmt(totalVolume)}.`,
    "",
    "*Ordered:*",
    orderLines.length ? orderLines.join("\n") : "  (none)",
    "",
    "*Did not order:*",
    notOrdered.length ? notOrdered.map((c) => `  ${c.businessName}`).join("\n") : "  (everyone ordered)"
  ].join("\n");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    throw new Error("Slack send failed: " + (await res.text()));
  }

  console.log("Summary posted to Slack.");
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
