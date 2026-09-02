"use strict";

// Sends the tokenized email template to the Anthropic API for a light
// rewrite (varied phrasing, same length/tone) before per-customer values are
// substituted in. The template's dynamic parts must stay as [[TOKEN]]
// placeholders — [[LINK]], [[NAME]], [[BUSINESS]], [[MONTH]] — so the same
// rewritten copy can be reused for every customer in the run.
//
// Fails closed: any error, empty response, an em dash in the output, or a
// token the input contained going missing from the output falls back to
// the caller using the unmodified tokenized template (returns null).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const TOKEN_PATTERN = /\[\[[A-Z]+\]\]/g;

async function rewriteEmailBody(tokenizedBody, apiKey) {
  if (!apiKey) return null;

  const requiredTokens = tokenizedBody.match(TOKEN_PATTERN) || [];

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content:
              "Rewrite this plain-text B2B email with different sentence structure and " +
              "phrasing, same length and tone, plain text only, no formatting, no em dashes. " +
              "Do not alter the tokens [[LINK]], [[NAME]], [[BUSINESS]], [[MONTH]] — copy them " +
              "exactly.\n\n" +
              tokenizedBody
          }
        ]
      })
    });

    if (!res.ok) return null;

    const data = await res.json();
    const text = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return null;
    if (!requiredTokens.every((token) => text.includes(token))) return null;
    if (text.includes("—")) return null;

    return text;
  } catch (err) {
    return null;
  }
}

module.exports = { rewriteEmailBody };
