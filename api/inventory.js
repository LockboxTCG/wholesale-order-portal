"use strict";

const { requireEnv } = require("./_gmail");
const { VARIANT_BY_NAME } = require("./_variants");
const { getStockByVariant } = require("./_inventory");

// Current stock for every portal product, keyed by normalized product name
// (the page normalizes its own names the same way). A number is the most that
// can be ordered; null means no limit. Cached briefly at the edge so a busy
// day of portal visits is a handful of Shopify calls, not one per visit.
module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
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

    const { stock: byVariant } = await getStockByVariant(gql, [...VARIANT_BY_NAME.values()]);
    const stock = {};
    for (const [name, variantId] of VARIANT_BY_NAME) {
      stock[name] = byVariant.has(variantId) ? byVariant.get(variantId) : null;
    }

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    res.status(200).json({ ok: true, stock });
  } catch (err) {
    console.error("inventory lookup failed:", err);
    // The page treats a failure as "no limits shown"; orders are still checked
    // on submit.
    res.status(502).json({ ok: false, error: "Stock levels unavailable" });
  }
};
