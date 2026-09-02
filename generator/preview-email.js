"use strict";

// Local dry run: renders the monthly email (base template, and the
// AI-rewritten version if ANTHROPIC_API_KEY is set) for a fake customer and
// prints it to the console. Sends nothing — no Gmail, no Sheets, no Vercel.
//
// Usage:
//   node generator/preview-email.js
//   PREVIEW_NAME="Jordan" PREVIEW_BUSINESS="Riverside Cards" node generator/preview-email.js

const { rewriteEmailBody } = require("./lib/rewriteEmail");
const { buildMonthlySubject, buildTokenizedBody, fillTokens } = require("./lib/monthlyEmail");

async function main() {
  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });
  const subject = buildMonthlySubject(monthLabel);
  const tokenizedBody = buildTokenizedBody();

  const fakeCustomer = {
    name: process.env.PREVIEW_NAME || "Alex",
    business: process.env.PREVIEW_BUSINESS || "Sample Card Shop",
    link: "https://wholesale.lockboxtcg.com/c/preview0000/"
  };

  console.log("=== Subject ===");
  console.log(subject);
  console.log();

  console.log("=== Base template (what sends if no rewrite happens) ===");
  console.log(
    fillTokens(tokenizedBody, {
      name: fakeCustomer.name,
      month: monthLabel,
      link: fakeCustomer.link,
      business: fakeCustomer.business
    })
  );
  console.log();

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("No ANTHROPIC_API_KEY set — set it in this shell to also preview the AI-rewritten version.");
    return;
  }

  const rewritten = await rewriteEmailBody(tokenizedBody, process.env.ANTHROPIC_API_KEY);
  if (!rewritten) {
    console.log("Rewrite call failed, returned nothing, or dropped a token — real send would fall back to the base template above.");
    return;
  }

  console.log("=== AI-rewritten template (what actually sends this run) ===");
  console.log(
    fillTokens(rewritten, {
      name: fakeCustomer.name,
      month: monthLabel,
      link: fakeCustomer.link,
      business: fakeCustomer.business
    })
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
