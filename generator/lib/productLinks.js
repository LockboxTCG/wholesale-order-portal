"use strict";

// Attaches each product's lockboxtcg.com page URL (productLinks.json) to the
// parsed catalog so the portal can link the product name. A product with no
// entry just renders as plain text; the caller is told which ones so a new
// or renamed row in the Pricing Sheet doesn't silently lose its link.

const LINKS = require("./productLinks.json");

function normalizeName(name) {
  return String(name || "").replace(/\s*[–—-]\s*/g, " - ").replace(/\s+/g, " ").trim().toLowerCase();
}

const URL_BY_NAME = new Map(
  Object.entries(LINKS)
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, url]) => [normalizeName(name), url])
);

function attachProductLinks(catalog) {
  const missing = [];
  const linked = catalog.map((cat) => ({
    ...cat,
    products: cat.products.map((p) => {
      const url = URL_BY_NAME.get(normalizeName(p.name));
      if (!url) missing.push(p.name);
      return url ? { ...p, url } : p;
    })
  }));
  return { catalog: linked, missing };
}

module.exports = { attachProductLinks };
