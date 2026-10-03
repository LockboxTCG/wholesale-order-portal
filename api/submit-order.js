"use strict";

const VARIANTS = require("./shopifyVariants.json");

// Match product names ignoring dash style (a typed hyphen vs the long dash),
// missing or repeated spaces around a dash, and letter case, so a hand-edited
// name in the Pricing Sheet can't silently stop matching its Shopify variant.
function normalizeName(name) {
  return String(name || "")
    .replace(/\s*[\u2013\u2014-]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const VARIANT_BY_NAME = new Map(
  Object.entries(VARIANTS)
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, id]) => [normalizeName(name), id])
);

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

// RFC 2047 encoded-word: message headers (unlike the body) are ASCII-only by
// default, so a raw non-ASCII character in the Subject line would render as
// mojibake in Gmail.
function encodeHeader(str) {
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
}

function buildEmail({ to, from, subject, body }) {
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodeHeader(subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    body
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getGmailAccessToken() {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requireEnv("GMAIL_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: requireEnv("GMAIL_REFRESH_TOKEN")
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error("Could not mint a Gmail access token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

async function gmailSend(accessToken, raw) {
  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });
  if (!sendRes.ok) {
    throw new Error("Gmail send failed: " + (await sendRes.text()));
  }
}

async function sendNotificationEmail({ accessToken, customerName, monthLabel, tier, netSubtotal, adminUrl }) {
  const to = process.env.GMAIL_NOTIFY_TO || "management@lockboxtcg.com";

  const raw = buildEmail({
    to,
    from: to,
    subject: `New wholesale order — ${customerName} — ${monthLabel || ""}`,
    body: [
      `${customerName} just submitted a ${tier} tier order (${fmt(netSubtotal)}).`,
      "",
      `Review it in Shopify: ${adminUrl}`
    ].join("\n")
  });

  await gmailSend(accessToken, raw);
}

async function sendCustomerConfirmationEmail({ accessToken, customerEmail, monthLabel, items, netSubtotal }) {
  const from = process.env.GMAIL_SEND_FROM || "management@lockboxtcg.com";

  const orderLines = items
    .filter((i) => Number(i.qty) > 0)
    .map((i) => `  ${i.name} x${i.qty}: ${fmt(Number(i.unitPrice) * Number(i.qty))}`);

  const raw = buildEmail({
    to: customerEmail,
    from,
    subject: `Order received: ${monthLabel || ""}`,
    body: [
      "Thanks, we've received your order.",
      "",
      "Your order:",
      ...orderLines,
      "",
      `Subtotal: ${fmt(netSubtotal)}`,
      "",
      "We'll follow up with an official invoice and an estimated fulfillment timeline as soon as possible. " +
        "Reply here if anything looks off or you have questions.",
      "",
      "Thanks,",
      "LockboxTCG"
    ].join("\n")
  });

  await gmailSend(accessToken, raw);
}

async function sendSlackNotification({ customerName, monthLabel, tier, netSubtotal, adminUrl }) {
  const webhookUrl = requireEnv("SLACK_WEBHOOK_URL");

  const text =
    `*New wholesale order — ${customerName} — ${monthLabel || ""}*\n` +
    `Tier: ${tier} · Subtotal: ${fmt(netSubtotal)}\n` +
    `<${adminUrl}|Review it in Shopify>`;

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) {
    throw new Error("Slack notification failed: " + (await res.text()));
  }
}

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
    const variantId = VARIANT_BY_NAME.get(normalizeName(i.name));
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
            note: noteLines,
            tags: ["wholesale-portal"]
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

    // The draft order is already safely created at this point — a failure
    // sending an internal notification shouldn't tell the customer their
    // submission failed, so each notification channel is independent: one
    // failing is logged but never surfaces as an error, and never blocks
    // the other from still going out.
    const draftOrderGid = data.data.draftOrderCreate.draftOrder.id;
    const numericId = draftOrderGid.split("/").pop();
    const shopHandle = shop.replace(/\.myshopify\.com$/, "");
    const adminUrl = `https://admin.shopify.com/store/${shopHandle}/draft_orders/${numericId}`;
    const netSubtotalNum = Number(netSubtotal) || 0;
    const notifyArgs = { customerName, monthLabel, tier, netSubtotal: netSubtotalNum, adminUrl };

    let gmailAccessToken = null;
    try {
      gmailAccessToken = await getGmailAccessToken();
    } catch (tokenErr) {
      console.error("Could not get a Gmail access token (order was still created):", tokenErr);
    }

    if (gmailAccessToken) {
      try {
        await sendNotificationEmail({ accessToken: gmailAccessToken, ...notifyArgs });
      } catch (notifyErr) {
        console.error("Order notification email failed (order was still created):", notifyErr);
      }

      if (customerEmail) {
        try {
          await sendCustomerConfirmationEmail({
            accessToken: gmailAccessToken,
            customerEmail,
            monthLabel,
            items,
            netSubtotal: netSubtotalNum
          });
        } catch (confirmErr) {
          console.error("Customer confirmation email failed (order was still created):", confirmErr);
        }
      }
    }

    try {
      await sendSlackNotification(notifyArgs);
    } catch (notifyErr) {
      console.error("Order Slack notification failed (order was still created):", notifyErr);
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
