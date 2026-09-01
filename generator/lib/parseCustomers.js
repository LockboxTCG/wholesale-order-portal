"use strict";

// Parses the "Customer directory" sheet. Expected header row (order doesn't
// matter, matched by name): Business name, Contact first name, Contact
// email, Logo URL, Notes. Rows with no business name are skipped.

function parseCustomers(grid) {
  const header = (grid[0] || []).map((h) => String(h || "").trim().toLowerCase());
  const col = (name) => header.indexOf(name);

  const businessCol = col("business name");
  const firstNameCol = col("contact first name");
  const emailCol = col("contact email");
  const logoCol = col("logo url");

  if (businessCol === -1) {
    throw new Error('Customer directory sheet is missing a "Business name" column');
  }

  const customers = [];
  for (let row = 1; row < grid.length; row++) {
    const businessName = (grid[row][businessCol] || "").toString().trim();
    if (!businessName) continue;
    customers.push({
      businessName,
      contactFirstName: firstNameCol !== -1 ? (grid[row][firstNameCol] || "").toString().trim() : "",
      contactEmail: emailCol !== -1 ? (grid[row][emailCol] || "").toString().trim() : "",
      logoUrl: logoCol !== -1 ? (grid[row][logoCol] || "").toString().trim() : ""
    });
  }
  return customers;
}

module.exports = { parseCustomers };
