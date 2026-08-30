"use strict";

const crypto = require("crypto");

function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Deterministic: the same business name always produces the same slug, so a
// customer's link never changes month to month, without ever writing a slug
// column back into the directory sheet. Unguessability comes entirely from
// PORTAL_SLUG_SECRET staying secret — treat it like any other credential.
function customerSlug(businessName, secret) {
  if (!secret) {
    throw new Error("PORTAL_SLUG_SECRET is required to derive customer slugs");
  }
  const base = slugify(businessName) || "customer";
  const hash = crypto.createHmac("sha256", secret).update(businessName).digest("hex").slice(0, 10);
  return base + "-" + hash;
}

module.exports = { slugify, customerSlug };
