"use strict";

// Parses a customer's raw "Price Overrides" cell (Customer Directory
// sheet) into a list of {prefix, price} rules, and applies them to a
// parsed catalog for that one customer only.
//
// Cell format: one rule per line (or semicolon-separated), each shaped
// "<product name prefix> = $<price>". A rule applies to every product
// whose name starts with its prefix (case-insensitive) — e.g.
// "Single Matte Sleeves = $4.99" matches all 4 color variants — and
// replaces that product's price at every tier, for that customer's page
// only. The shared catalog used by every other customer is untouched.

const RULE_RE = /^(.+?)=\s*\$?\s*(-?[\d,]+(?:\.\d+)?)\s*$/;

function parsePriceOverrides(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  return text
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(RULE_RE);
      if (!m) {
        throw new Error(
          `Could not parse price override rule "${line}" (expected "<product name> = $<price>")`
        );
      }
      return { prefix: m[1].trim(), price: parseFloat(m[2].replace(/,/g, "")) };
    });
}

function applyPriceOverrides(catalog, overrides, businessName) {
  if (!overrides.length) return catalog;

  const matchedPrefixes = new Set();

  const overridden = catalog.map((cat) => ({
    category: cat.category,
    products: cat.products.map((p) => {
      const rule = overrides.find((o) => p.name.toLowerCase().startsWith(o.prefix.toLowerCase()));
      if (!rule) return p;
      matchedPrefixes.add(rule.prefix);
      return { ...p, tiers: { Starter: rule.price, Growth: rule.price, Volume: rule.price } };
    })
  }));

  for (const o of overrides) {
    if (!matchedPrefixes.has(o.prefix)) {
      console.warn(
        `Price override "${o.prefix} = $${o.price}" for "${businessName}" matched no products — ` +
          "check the spelling against the pricing sheet's product names."
      );
    }
  }

  return overridden;
}

module.exports = { parsePriceOverrides, applyPriceOverrides };
