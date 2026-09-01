"use strict";

const VARIANTS = require("./shopifyVariants.json");

function fmt(n) {
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const DRAFT_ORDER_CREATE = `
  mutation draftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        name
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: "Invalid JSON body" });
      return;
    }
  }

  const { slug, customerName, customerEmail, monthLabel, tier, items, grossValue, netSubtotal, saved } = body || {};

  if (!customerName || !Array.isArray(items)) {
    res.status(400).json({ ok: false, error: "Malformed order payload" });
    return;
  }

  // Re-check the same "below minimum" state the UI already computed and
  // disables its Submit button on, rather than a separate server-side rule:
  // no tier (gross MSRP value under the Starter threshold) or an all-zero
  // order is not submittable.
  const hasQty = items.some((i) => Number(i.qty) > 0);
  if (!tier || !hasQty) {
    res.status(400).json({ ok: false, error: "This order is below the Starter minimum and can't be submitted." });
    return;
  }

  const lineItems = [];
  for (const i of items) {
    const qty = Number(i.qty) || 0;
    if (qty <= 0) continue;
    const variantId = VARIANTS[i.name];
    if (!variantId) {
      res.status(500).json({ ok: false, error: `No Shopify product mapped for "${i.name}"` });
      return;
    }
    // Always use the catalog's tier-computed price, never the Shopify
    // variant's own listed price — the two can legitimately drift (wholesale
    // pricing isn't the storefront price) and the catalog is the source of
    // truth for what this customer actually owes. A variant-based line item
    // ignores plain "originalUnitPrice" and uses the variant's own price
    // unless a priceOverride is set explicitly.
    lineItems.push({
      variantId,
      quantity: qty,
      priceOverride: {
        amount: (Number(i.unitPrice) || 0).toFixed(2),
        currencyCode: "CAD"
      }
    });
  }

  const noteLines = [
    `${customerName}${customerEmail ? " <" + customerEmail + ">" : ""}`,
    `Portal: ${slug || "(unknown)"}`,
    `Month: ${monthLabel || ""}`,
    `Tier: ${tier}`,
    `Subtotal: ${fmt(Number(netSubtotal) || 0)}`,
    `Discount applied: ${fmt(Number(saved) || 0)} (list price ${fmt(Number(grossValue) || 0)})`
  ].join("\n");

  try {
    const shop = requireEnv("SHOPIFY_SHOP");
    const token = requireEnv("SHOPIFY_ACCESS_TOKEN");

    const shopifyRes = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        query: DRAFT_ORDER_CREATE,
        variables: {
          input: {
            lineItems,
            note: noteLines
          }
        }
      })
    });

    const data = await shopifyRes.json();
    const userErrors = data?.data?.draftOrderCreate?.userErrors || [];
    if (!shopifyRes.ok || data.errors || userErrors.length > 0) {
      console.error("draftOrderCreate failed:", JSON.stringify(data.errors || userErrors));
      res.status(502).json({ ok: false, error: "Could not create the draft order. Please try again shortly." });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("submit-order failed:", err);
    res.status(502).json({ ok: false, error: "Could not create the draft order. Please try again shortly." });
  }
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
