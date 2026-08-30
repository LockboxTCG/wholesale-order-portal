"use strict";

const { google } = require("googleapis");

function fmt(n) {
  return "$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildEmail({ to, from, subject, body }) {
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
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

  const { slug, customerName, monthLabel, tier, items } = body || {};

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

  const lines = items.map((i) => {
    const qty = Number(i.qty) || 0;
    const msrp = Number(i.msrp) || 0;
    return `  ${qty} x ${i.name} (MSRP ${fmt(msrp)} ea)`;
  });

  const emailBody = [
    `Wholesale order — ${customerName} — ${monthLabel || ""}`,
    `Tier: ${tier}`,
    `Portal: ${slug || "(unknown)"}`,
    "",
    "Items:",
    ...lines,
    "",
    "(Line pricing and totals are shown on the customer's portal page — this",
    "draft lists requested quantities at MSRP; confirm tier pricing before",
    "replying.)"
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
