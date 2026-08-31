"use strict";

const { google } = require("googleapis");

function fmt(n) {
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// RFC 2047 encoded-word: message headers (unlike the body) are ASCII-only by
// default, so a raw em dash in the Subject line renders as mojibake in Gmail.
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
  const raw = Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return raw;
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

  const { slug, customerName, monthLabel, tier, items, grossValue, netSubtotal, saved } = body || {};

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

  const nameWidth = Math.max(...items.map((i) => String(i.name).length));
  const lines = items.map((i) => {
    const qty = Number(i.qty) || 0;
    const unitPrice = Number(i.unitPrice) || 0;
    const lineTotal = Number(i.lineTotal) || 0;
    const label = `${qty} x ${i.name}`.padEnd(nameWidth + 6);
    return `  ${label}  ${fmt(unitPrice)} ea   ${fmt(lineTotal)}`;
  });

  const emailBody = [
    `Wholesale order — ${customerName} — ${monthLabel || ""}`,
    `Tier: ${tier}`,
    `Portal: ${slug || "(unknown)"}`,
    "",
    "Items:",
    ...lines,
    "",
    `Subtotal:          ${fmt(Number(netSubtotal) || 0)}`,
    `Discount applied:  ${fmt(Number(saved) || 0)}  (list price ${fmt(Number(grossValue) || 0)})`
  ].join("\n");

  try {
    const auth = new google.auth.OAuth2(
      requireEnv("GMAIL_CLIENT_ID"),
      requireEnv("GMAIL_CLIENT_SECRET")
    );
    auth.setCredentials({ refresh_token: requireEnv("GMAIL_REFRESH_TOKEN") });

    const gmail = google.gmail({ version: "v1", auth });
    const toAddress = process.env.GMAIL_DRAFT_TO || "management@lockboxtcg.com";

    await gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: buildEmail({
            to: toAddress,
            from: toAddress,
            subject: `Wholesale order — ${customerName} — ${monthLabel || ""}`,
            body: emailBody
          })
        }
      }
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("submit-order failed:", err);
    res.status(502).json({ ok: false, error: "Could not create the order draft. Please try again shortly." });
  }
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
