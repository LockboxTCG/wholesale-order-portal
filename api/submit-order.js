"use strict";

const { normalizeName, VARIANT_BY_NAME } = require("./_variants");
const { getStockByVariant } = require("./_inventory");
const { requireEnv, buildEmail, getGmailAccessToken, gmailSend } = require("./_gmail");
const { resolveCompany } = require("./_shopifyCompany");

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

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

async function sendNotificationEmail({ accessToken, customerName, contactName, customerEmail, newCustomer, monthLabel, tier, netSubtotal, adminUrl, companyLine }) {
  const to = process.env.GMAIL_NOTIFY_TO || "management@lockboxtcg.com";

  const raw = buildEmail({
    to,
    from: to,
    subject: `New wholesale order${newCustomer ? " (new customer)" : ""} — ${customerName} — ${monthLabel || ""}`,
    body: [
      `${customerName} just submitted a ${tier} tier order (${fmt(netSubtotal)}).`,
      ...(newCustomer
        ? ["", "They are not in the customer directory. Contact: " + contactName + " <" + customerEmail + ">"]
        : []),
      "",
      companyLine,
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

async function sendSlackNotification({ customerName, contactName, customerEmail, newCustomer, monthLabel, tier, netSubtotal, adminUrl, companyLine }) {
  const webhookUrl = requireEnv("SLACK_WEBHOOK_URL");

  const text =
    `*New wholesale order${newCustomer ? " (new customer)" : ""} — ${customerName} — ${monthLabel || ""}*\n` +
    (newCustomer ? `Not in the directory. Contact: ${contactName} <${customerEmail}>\n` : "") +
    `Tier: ${tier} · Subtotal: ${fmt(netSubtotal)}\n` +
    `${companyLine}\n` +
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

  const { slug, customerName, customerEmail, contactName, companyName, newCustomer, monthLabel, tier, items, grossValue, netSubtotal, saved } = body || {};

  if (!customerName || !Array.isArray(items)) {
    res.status(400).json({ ok: false, error: "Malformed order payload" });
    return;
  }

  // The shared sign-up portal has no directory record behind it, so the
  // details typed into its form are all we have: require them, and make sure
  // the email is a single plain address before anything is sent to it.
  const isNew = newCustomer === true;
  if (isNew && (!String(contactName || "").trim() || !EMAIL_RE.test(String(customerEmail || "").trim()))) {
    res.status(400).json({ ok: false, error: "Please enter your name and a valid email address." });
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
  const lineNames = [];
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
    lineNames.push(String(i.name));
    lineItems.push({
      variantId,
      quantity: qty,
      priceOverride: {
        amount: (Number(i.unitPrice) || 0).toFixed(2),
        currencyCode: "CAD"
      }
    });
  }

  const buildNote = (companyLine) =>
    [
      ...(isNew ? ["NEW CUSTOMER (not in the directory)", `Contact: ${String(contactName).trim()}`] : []),
      `${customerName}${customerEmail ? " <" + customerEmail + ">" : ""}`,
      ...(companyLine ? [companyLine] : []),
      `Portal: ${slug || "(unknown)"}`,
      `Month: ${monthLabel || ""}`,
      `Tier: ${tier}`,
      `Subtotal: ${fmt(Number(netSubtotal) || 0)}`,
      `Discount applied: ${fmt(Number(saved) || 0)} (list price ${fmt(Number(grossValue) || 0)})`
    ].join("\n");

  try {
    const shop = requireEnv("SHOPIFY_SHOP");
    const token = requireEnv("SHOPIFY_ACCESS_TOKEN");

    const endpoint = `https://${shop}/admin/api/2026-07/graphql.json`;
    const shopifyFetch = (query, variables) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables })
      });
    const gql = async (query, variables) => {
      const r = await shopifyFetch(query, variables);
      const json = await r.json();
      if (!r.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
      return json.data;
    };

    // Hard stop on stock: nothing above what is available can be ordered.
    // Quantities are summed per Shopify variant (the renamed matte sleeve
    // names point at the same variant). If Shopify can't be asked, the order
    // goes through and the alert says stock wasn't verified, so a Shopify
    // hiccup never blocks a customer.
    let stockWarning = "";
    let overStock = [];
    try {
      const { stock, reservationsApplied } = await getStockByVariant(gql, lineItems.map((l) => l.variantId));
      if (!reservationsApplied) {
        stockWarning = "Stock was checked WITHOUT subtracting open draft orders (couldn't read them)";
      }
      const wanted = new Map();
      lineItems.forEach((l) => wanted.set(l.variantId, (wanted.get(l.variantId) || 0) + l.quantity));
      const seen = new Set();
      lineItems.forEach((l, idx) => {
        const available = stock.get(l.variantId);
        if (seen.has(l.variantId) || typeof available !== "number") return;
        seen.add(l.variantId);
        if (wanted.get(l.variantId) > available) {
          overStock.push({ name: lineNames[idx], available });
        }
      });
    } catch (stockErr) {
      stockWarning = "Stock was NOT checked for this order (" + (stockErr.message || stockErr) + ")";
      console.error("Stock check failed (order will go through unchecked):", stockErr);
    }
    if (overStock.length > 0) {
      const list = overStock
        .map((o) => `${o.name} (${o.available > 0 ? "only " + o.available + " available" : "out of stock"})`)
        .join(", ");
      res.status(409).json({
        ok: false,
        error: `Not enough stock for: ${list}. Please lower the quantity and send again.`
      });
      return;
    }

    // Attach the order to the customer's Shopify company (found, or created
    // if they have none). Anything going wrong here must never lose the
    // order: it falls back to a plain draft order and says so in the alert.
    let company = null;
    let companyProblem = null;
    try {
      company = await resolveCompany({
        gql,
        companyName: String(companyName || customerName || "").trim(),
        contactName,
        contactEmail: customerEmail
      });
    } catch (companyErr) {
      companyProblem = companyErr.message || String(companyErr);
      console.error("Could not attach a Shopify company (order will be created without one):", companyErr);
    }

    const baseInput = {
      lineItems,
      tags: isNew ? ["wholesale-portal", "new-customer"] : ["wholesale-portal"]
    };
    const withCompany = () => ({
      ...baseInput,
      note: buildNote(`Shopify company: ${company.companyName} (${company.status === "created" ? "created automatically" : "matched"})`),
      purchasingEntity: {
        purchasingCompany: {
          companyId: company.companyId,
          companyContactId: company.contactId,
          companyLocationId: company.locationId
        }
      }
    });
    const withoutCompany = () => ({
      ...baseInput,
      note: buildNote("Shopify company: NOT attached, please attach it by hand"),
      ...(isNew ? { email: String(customerEmail).trim() } : {})
    });

    let data = null;
    let attached = false;
    if (company) {
      const r = await shopifyFetch(DRAFT_ORDER_CREATE, { input: withCompany() });
      const d = await r.json();
      const errs = d?.data?.draftOrderCreate?.userErrors || [];
      if (r.ok && !d.errors && errs.length === 0) {
        data = d;
        attached = true;
      } else {
        companyProblem = "draft order rejected the company: " + JSON.stringify(d.errors || errs);
        console.error("draftOrderCreate with company failed, retrying without it:", companyProblem);
      }
    }
    if (!data) {
      const r = await shopifyFetch(DRAFT_ORDER_CREATE, { input: withoutCompany() });
      const d = await r.json();
      const errs = d?.data?.draftOrderCreate?.userErrors || [];
      if (!r.ok || d.errors || errs.length > 0) {
        console.error("draftOrderCreate failed:", JSON.stringify(d.errors || errs));
        res.status(502).json({ ok: false, error: "Could not create the draft order. Please try again shortly." });
        return;
      }
      data = d;
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
    const notifyArgs = {
      customerName,
      contactName: isNew ? String(contactName).trim() : "",
      customerEmail: isNew ? String(customerEmail).trim() : "",
      newCustomer: isNew,
      monthLabel,
      tier,
      netSubtotal: netSubtotalNum,
      adminUrl,
      companyLine: attached
        ? `Shopify company: ${company.companyName} (${company.status === "created" ? "created automatically" : "matched"})`
        : `WARNING: no Shopify company attached, please attach it by hand (${companyProblem || "unknown reason"})`
    };
    if (stockWarning) notifyArgs.companyLine += "\n" + stockWarning;

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

      if (customerEmail && EMAIL_RE.test(String(customerEmail).trim())) {
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
