"use strict";

// Parses the pricing grid exactly as laid out in "(CAD) Brick & Mortar Pricing":
//   - Row 2 (index 1): category headers, one per category's leftmost column.
//     Categories sit side by side, each occupying 3 columns (tier label /
//     wholesale price / discount), separated by one blank spacer column.
//   - Within a category's 3 columns, products stack vertically in fixed
//     6-row blocks starting at row 3 (index 2):
//       row+0: product name
//       row+1: "MSRP: <price>"
//       row+2: "Tier,Wholesale,Discount" header (ignored)
//       row+3: Starter row  (tier label, wholesale price, discount)
//       row+4: Growth row
//       row+5: Volume row
//     A category ends at the first block whose name cell is empty.
//   - Columns A/B, rows 4-6 (index 3-5): tier thresholds as
//     "<Tier name>", "$<lower bound>[-<upper>|+]".
//
// This mirrors the grid confirmed by hand against the source workbook and the
// live Google Sheet — see design_handoff_wholesale_order_portal/README.md.

const TIER_ORDER = ["Starter", "Growth", "Volume"];
const BLOCK_ROWS = 6;

function cell(grid, row, col) {
  const r = grid[row];
  return r ? (r[col] === undefined ? "" : String(r[col]).trim()) : "";
}

function parseMoney(str) {
  const m = String(str).match(/-?[\d,]+(\.\d+)?/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : NaN;
}

function parseTierThresholds(grid) {
  const thresholds = {};
  for (let row = 3; row <= 5; row++) {
    const name = cell(grid, row, 0).replace(/\s+$/, "");
    const tier = TIER_ORDER.find((t) => t.toLowerCase() === name.toLowerCase());
    if (!tier) continue;
    const value = cell(grid, row, 1);
    thresholds[tier] = parseMoney(value);
  }
  for (const t of TIER_ORDER) {
    if (!Number.isFinite(thresholds[t])) {
      throw new Error(`Could not parse the "${t}" tier threshold from the pricing sheet`);
    }
  }
  return thresholds;
}

function parseCatalog(grid) {
  const headerRow = grid[1] || [];
  const categoryStartCols = [];
  for (let col = 3; col < headerRow.length; col++) {
    if (cell(grid, 1, col)) categoryStartCols.push(col);
  }
  if (categoryStartCols.length === 0) {
    throw new Error("Could not find any category headers in row 2 of the pricing sheet");
  }

  return categoryStartCols.map((startCol) => {
    const category = cell(grid, 1, startCol);
    const products = [];
    let row = 2; // first product title row (0-indexed row 2 == sheet row 3)

    while (true) {
      const name = cell(grid, row, startCol);
      if (!name) break;

      const msrp = parseMoney(cell(grid, row + 1, startCol));
      const tiers = {};
      TIER_ORDER.forEach((t, i) => {
        tiers[t] = parseMoney(cell(grid, row + 3 + i, startCol + 1));
      });

      if (!Number.isFinite(msrp) || !Number.isFinite(tiers.Starter)) {
        throw new Error(`Could not parse MSRP/Starter pricing for "${name}" in "${category}"`);
      }
      // A product can have Growth/Volume rows left blank in the sheet (e.g.
      // "Single Matte Sleeves" — Starter-only in the source workbook). Fall
      // back to Starter's rate rather than failing the whole build.
      TIER_ORDER.forEach((t) => {
        if (!Number.isFinite(tiers[t])) {
          console.warn(`"${name}" in "${category}" has no ${t} rate — falling back to Starter's rate.`);
          tiers[t] = tiers.Starter;
        }
      });

      products.push({ name, msrp, tiers });
      row += BLOCK_ROWS;
    }

    if (products.length === 0) {
      throw new Error(`Category "${category}" has no parseable products`);
    }

    return { category, products };
  });
}

module.exports = { parseCatalog, parseTierThresholds };
