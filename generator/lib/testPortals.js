"use strict";

// Portals that exist only for testing and are not real customers. They are
// built alongside the real customer pages (same hidden-link scheme, same
// catalog, standard pricing) but never come from the Customer Directory
// sheet, so they are never emailed the monthly link or the reminder.
//
// Orders placed from one are real draft orders, so the name starts with
// "TEST": that makes them easy to spot and delete in Shopify, and the
// monthly summary skips anything whose note starts with "TEST".

const TEST_PORTALS = [
  {
    businessName: "TEST Lockbox Internal",
    contactFirstName: "",
    contactEmail: "management@lockboxtcg.com",
    logoUrl: "",
    priceOverridesRaw: ""
  }
];

module.exports = { TEST_PORTALS };
