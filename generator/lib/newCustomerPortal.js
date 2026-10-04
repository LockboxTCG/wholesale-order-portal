"use strict";

// One shared portal for anyone who is not in the Customer Directory (a new
// store that joins mid-month). It is built like every other customer page,
// with standard pricing and its own hidden link, but starts with a short
// form (name, email, store or company). Whatever the visitor enters becomes
// the customer on their order.
//
// It is not a directory customer, so it is never emailed the monthly link
// or the reminder. When someone is added to the directory, they get their
// own page from the next run.

const NEW_CUSTOMER_PORTAL = {
  businessName: "New Customer Portal",
  contactFirstName: "",
  contactEmail: "",
  logoUrl: "",
  priceOverridesRaw: "",
  intake: true
};

module.exports = { NEW_CUSTOMER_PORTAL };
