"use strict";

const VARIANTS = require("./shopifyVariants.json");

// Match product names ignoring dash style (a typed hyphen vs the long dash),
// missing or repeated spaces around a dash, and letter case, so a hand-edited
// name in the Pricing Sheet can't silently stop matching its Shopify variant.
function normalizeName(name) {
  return String(name || "")
    .replace(/\s*[–—-]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// normalized product name -> Shopify variant GID
const VARIANT_BY_NAME = new Map(
  Object.entries(VARIANTS)
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, id]) => [normalizeName(name), id])
);

module.exports = { normalizeName, VARIANT_BY_NAME };
