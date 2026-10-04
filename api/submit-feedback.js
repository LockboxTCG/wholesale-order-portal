"use strict";

const { requireEnv, buildEmail, getGmailAccessToken, gmailSend } = require("./_gmail");

const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// Slack mrkdwn only needs these three escaped; this stops customer text from
// forming links or @-mentions in the channel.
function slackEscape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Header values come from a public form, so drop anything that could add a
// header line.
function oneLine(text) {
  return String(text || "").replace(/[\r\n]+/g, " ").trim();
}

async function sendFeedbackEmail({ accessToken, customerName, customerEmail, contactName, monthLabel, slug, message }) {
  const to = process.env.GMAIL_NOTIFY_TO || "management@lockboxtcg.com";
  const raw = buildEmail({
    to,
    from: to,
    replyTo: customerEmail || undefined,
    subject: `Portal feedback: ${customerName}`,
    body: [
      `${customerName}${contactName ? " (" + contactName + ")" : ""} sent feedback from the wholesale portal (${monthLabel || "no month"}).`,
      customerEmail ? `Reply to this email to answer them at ${customerEmail}.` : "No contact email on file for this customer.",
      "",
      message,
      "",
      `Portal: ${slug || "(unknown)"}`
    ].join("\n")
  });
  await gmailSend(accessToken, raw);
}

async function sendFeedbackSlack({ customerName, contactName, monthLabel, message }) {
  const res = await fetch(requireEnv("SLACK_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `*Portal feedback: ${slackEscape(customerName)}${contactName ? " (" + slackEscape(contactName) + ")" : ""}* (${slackEscape(monthLabel || "")})\n>${slackEscape(message).replace(/\n/g, "\n>")}`
    })
  });
  if (!res.ok) {
    throw new Error("Slack feedback notification failed: " + (await res.text()));
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

  const { slug, customerName, customerEmail, contactName, monthLabel, message, website } = body || {};

  // Hidden field a person never fills in; a bot that does gets a normal-looking
  // success so it learns nothing.
  if (website) {
    res.status(200).json({ ok: true });
    return;
  }

  const text = String(message || "").trim();
  if (!customerName || !text) {
    res.status(400).json({ ok: false, error: "Please write a message first." });
    return;
  }
  if (text.length > MAX_MESSAGE) {
    res.status(400).json({ ok: false, error: `Please keep feedback under ${MAX_MESSAGE} characters.` });
    return;
  }

  const args = {
    customerName: oneLine(customerName).slice(0, 200),
    customerEmail: EMAIL_RE.test(oneLine(customerEmail)) ? oneLine(customerEmail) : "",
    contactName: oneLine(contactName).slice(0, 100),
    monthLabel: oneLine(monthLabel).slice(0, 50),
    slug: oneLine(slug).slice(0, 100),
    message: text
  };

  // Either channel reaching the team counts as delivered; only if both fail
  // does the customer see an error.
  let delivered = false;

  try {
    await sendFeedbackEmail({ accessToken: await getGmailAccessToken(), ...args });
    delivered = true;
  } catch (err) {
    console.error("Feedback email failed:", err);
  }

  try {
    await sendFeedbackSlack(args);
    delivered = true;
  } catch (err) {
    console.error("Feedback Slack notification failed:", err);
  }

  if (!delivered) {
    res.status(502).json({ ok: false, error: "Could not send your feedback. Please try again shortly." });
    return;
  }
  res.status(200).json({ ok: true });
};
