"use strict";

const { requireEnv, buildEmail, getGmailAccessToken, gmailSend } = require("./_gmail");

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function slackEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function oneLine(text) {
  return String(text || "").replace(/[\r\n]+/g, " ").trim();
}

// Heads-up to the team the first time someone fills in the sign-up form on
// the shared new-customer portal, so a store that browses but never orders is
// still a lead to follow up.
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

  const { name, email, company, website } = body || {};

  if (website) {
    res.status(200).json({ ok: true });
    return;
  }

  const contact = { name: oneLine(name).slice(0, 100), email: oneLine(email), company: oneLine(company).slice(0, 150) };
  if (!contact.name || !contact.company || !EMAIL_RE.test(contact.email)) {
    res.status(400).json({ ok: false, error: "Please enter your name, store or company, and a valid email." });
    return;
  }

  let delivered = false;

  try {
    const to = process.env.GMAIL_NOTIFY_TO || "management@lockboxtcg.com";
    const raw = buildEmail({
      to,
      from: to,
      replyTo: contact.email,
      subject: `New wholesale sign-up: ${contact.company}`,
      body: [
        `${contact.name} from ${contact.company} just opened the new-customer wholesale portal.`,
        `Email: ${contact.email}`,
        "",
        "They are not in the customer directory yet. If they place an order it arrives as a draft order tagged new-customer. Add them to the directory to include them in the monthly emails."
      ].join("\n")
    });
    await gmailSend(await getGmailAccessToken(), raw);
    delivered = true;
  } catch (err) {
    console.error("New customer email failed:", err);
  }

  try {
    const r = await fetch(requireEnv("SLACK_WEBHOOK_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text:
          `*New wholesale sign-up: ${slackEscape(contact.company)}*\n` +
          `${slackEscape(contact.name)} <${slackEscape(contact.email)}> opened the new-customer portal. Not in the directory yet.`
      })
    });
    if (!r.ok) throw new Error(await r.text());
    delivered = true;
  } catch (err) {
    console.error("New customer Slack notification failed:", err);
  }

  if (!delivered) {
    res.status(502).json({ ok: false, error: "Could not record your details." });
    return;
  }
  res.status(200).json({ ok: true });
};
