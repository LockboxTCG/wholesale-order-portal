"use strict";

const crypto = require("crypto");
const { requireEnv } = require("./_gmail");

// Who has ordered, or has a draft order going, in the last N days. The monthly
// email job asks this before sending so a customer who is already mid-order
// isn't emailed the ordering link. Needs the same Authorization header the
// job derives from GMAIL_CLIENT_SECRET (both sides hold it), so it is not
// public.
//
// Draft orders (any status except gone) updated in the window cover every
// portal order and anything made by hand in Shopify; completed drafts are the
// orders they became. Plain orders are added when the token may read them;
// ordersChecked says whether that part worked.

const DRAFTS_QUERY = `
  query($after: String, $q: String!) {
    draftOrders(first: 100, after: $after, query: $q) {
      nodes {
        name
        status
        createdAt
        email
        note2
        customer { defaultEmailAddress { emailAddress } }
        purchasingEntity { ... on PurchasingCompany { company { name } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const ORDERS_QUERY = `
  query($after: String, $q: String!) {
    orders(first: 100, after: $after, query: $q) {
      nodes {
        name
        createdAt
        cancelledAt
        email
        customer { defaultEmailAddress { emailAddress } }
        purchasingEntity { ... on PurchasingCompany { company { name } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function expectedToken() {
  return crypto.createHmac("sha256", requireEnv("GMAIL_CLIENT_SECRET")).update("recent-activity").digest("hex");
}

function authorized(req) {
  const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const want = expectedToken();
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function pageAll(gql, query, field, q) {
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const data = await gql(query, { after, q });
    out.push(...data[field].nodes);
    if (!data[field].pageInfo.hasNextPage) break;
    after = data[field].pageInfo.endCursor;
  }
  return out;
}

function emailsOf(node) {
  const list = [node.email, node.customer && node.customer.defaultEmailAddress && node.customer.defaultEmailAddress.emailAddress];
  return [...new Set(list.filter(Boolean).map((e) => String(e).trim().toLowerCase()))];
}

function companyOf(node) {
  const e = node.purchasingEntity;
  return (e && e.company && e.company.name) || "";
}

function slugOf(note) {
  const m = /^Portal:\s*(\S+)\s*$/m.exec(note || "");
  return m && m[1] !== "(unknown)" ? m[1] : "";
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }
  try {
    if (!authorized(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const days = Math.min(90, Math.max(1, parseInt(req.query && req.query.days, 10) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const shop = requireEnv("SHOPIFY_SHOP");
    const token = requireEnv("SHOPIFY_ACCESS_TOKEN");
    const gql = async (query, variables) => {
      const r = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables })
      });
      const json = await r.json();
      if (!r.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
      return json.data;
    };

    const activity = [];

    const drafts = await pageAll(gql, DRAFTS_QUERY, "draftOrders", `updated_at:>=${since}`);
    for (const d of drafts) {
      activity.push({
        kind: "draft",
        ref: d.name,
        status: d.status,
        at: d.createdAt,
        emails: emailsOf(d),
        company: companyOf(d),
        slug: slugOf(d.note2)
      });
    }

    let ordersChecked = true;
    let ordersError = "";
    try {
      const orders = await pageAll(gql, ORDERS_QUERY, "orders", `created_at:>=${since}`);
      for (const o of orders) {
        if (o.cancelledAt) continue;
        activity.push({
          kind: "order",
          ref: o.name,
          status: "PLACED",
          at: o.createdAt,
          emails: emailsOf(o),
          company: companyOf(o),
          slug: ""
        });
      }
    } catch (err) {
      ordersChecked = false;
      ordersError = String(err.message || err).slice(0, 300);
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, days, since, ordersChecked, ordersError, activity });
  } catch (err) {
    console.error("recent-activity failed:", err);
    res.status(502).json({ ok: false, error: "Could not read recent activity" });
  }
};
