"use strict";

// One-off portals that are not rows in the Customer Directory: a person or
// store given a page with a fixed arrangement. They are built with the same
// hidden-link scheme and catalog as everyone else, and because they do not
// come from the directory they are never emailed the monthly link or the
// reminder.
//
//   logoFile    image in generator/assets/logos/, shown in the header
//   shopifyCompany  name of the existing Shopify company orders attach to,
//               when it differs from businessName
//   lockedTier  "Starter" | "Growth" | "Volume": every order is priced at
//               that tier from the first item, with no minimum to unlock it
//
// The link is derived from businessName, so renaming one changes its URL.

const SPECIAL_PORTALS = [
  {
    businessName: "Metapod",
    contactFirstName: "",
    contactEmail: "",
    logoUrl: "",
    logoFile: "metapod.jpg",
    shopifyCompany: "ThatMetapodGuy",
    lockedTier: "Volume",
    priceOverridesRaw: ""
  }
];

module.exports = { SPECIAL_PORTALS };
