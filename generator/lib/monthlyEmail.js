"use strict";

// The monthly email's subject + tokenized body, shared by
// send-monthly-emails.js (the real send) and preview-email.js (a local,
// no-send dry run) so the preview can never drift from what actually goes
// out.

function buildMonthlySubject(monthLabel) {
  return `Your ${monthLabel} order page is ready`;
}

function buildTokenizedBody() {
  return [
    "Hi [[NAME]],",
    "",
    "Your [[MONTH]] ordering page for LockboxTCG is live:",
    "",
    "[[LINK]]",
    "",
    "Submit your order through the page and it’ll come to us as a draft order. We’ll follow up with an official invoice and an estimated fulfillment timeline as soon as possible.",
    "",
    "Reply here if you notice any incorrect products, pricing, or quantities on the page, or if you have questions about placing your order, product availability, or expected delivery timing. We’re happy to help.",
    "",
    "Thanks,",
    "LockboxTCG",
    "management@lockboxtcg.com"
  ].join("\n");
}

function fillTokens(template, { name, month, link, business }) {
  return template
    .split("[[NAME]]").join(name)
    .split("[[MONTH]]").join(month)
    .split("[[LINK]]").join(link)
    .split("[[BUSINESS]]").join(business);
}

module.exports = { buildMonthlySubject, buildTokenizedBody, fillTokens };
