"use strict";

// Live stock for the portal's products, read from Shopify.
//
// The number that counts is "available" at the location wholesale orders
// ship from (Canada by default; override with STOCK_LOCATION_NAME). Available
// is on-hand minus what is already committed to open orders, so it matches
// what the storefront would let someone buy. USA stock is not counted unless
// that location is configured.
//
// Result per variant: a whole number, or null when Shopify isn't tracking
// that item (no limit). A variant with no stock record at the location is 0.

const STOCK_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        inventoryItem {
          tracked
          inventoryLevels(first: 10) {
            nodes {
              location { name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
`;

function locationName() {
  return process.env.STOCK_LOCATION_NAME || "Canada Shop Location";
}

// gql(query, variables) -> data, throwing on transport or GraphQL errors.
async function getStockByVariant(gql, variantIds) {
  const ids = [...new Set(variantIds)];
  const data = await gql(STOCK_QUERY, { ids });
  const where = locationName().toLowerCase();
  const stock = new Map();
  for (const node of data.nodes) {
    if (!node) continue;
    const item = node.inventoryItem;
    if (!item || item.tracked === false) {
      stock.set(node.id, null);
      continue;
    }
    const level = item.inventoryLevels.nodes.find((l) => String(l.location.name).toLowerCase() === where);
    const available = level && level.quantities.find((q) => q.name === "available");
    stock.set(node.id, available ? Math.max(0, available.quantity) : 0);
  }
  return stock;
}

module.exports = { getStockByVariant, locationName };
