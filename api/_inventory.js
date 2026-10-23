"use strict";

// Live stock for the portal's products, read from Shopify.
//
// The number that counts is "available" at the location wholesale orders
// ship from (Canada by default; override with STOCK_LOCATION_ID). Available
// is on-hand minus what is already committed to open orders, so it matches
// what the storefront would let someone buy. USA stock is not counted unless
// that location is configured.
//
// Draft orders don't draw stock down in Shopify until they're completed, so
// what's sitting in open drafts (open or invoice sent, whoever made them) is
// subtracted too. Once a draft is paid and completed, Shopify itself commits
// the stock and the draft stops counting, so nothing is counted twice. A draft
// that is never completed or deleted holds its stock until someone does.
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
              location { id }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
`;

// Matched by ID: reading a location's name needs an extra permission, its ID
// doesn't. Canada Shop Location by default; STOCK_LOCATION_ID overrides it
// (a full "gid://shopify/Location/..." id).
const CANADA_LOCATION_ID = "gid://shopify/Location/86249373935";

function locationId() {
  return process.env.STOCK_LOCATION_ID || CANADA_LOCATION_ID;
}

const OPEN_DRAFTS_QUERY = `
  query($after: String) {
    draftOrders(first: 100, after: $after, query: "status:open OR status:invoice_sent") {
      nodes {
        lineItems(first: 100) { nodes { quantity variant { id } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// variant id -> total quantity sitting in open draft orders
async function getReservedByVariant(gql) {
  const reserved = new Map();
  let after = null;
  for (let page = 0; page < 10; page++) {
    const data = await gql(OPEN_DRAFTS_QUERY, { after });
    for (const draft of data.draftOrders.nodes) {
      for (const li of draft.lineItems.nodes) {
        if (!li.variant) continue;
        reserved.set(li.variant.id, (reserved.get(li.variant.id) || 0) + li.quantity);
      }
    }
    if (!data.draftOrders.pageInfo.hasNextPage) break;
    after = data.draftOrders.pageInfo.endCursor;
  }
  return reserved;
}

// gql(query, variables) -> data, throwing on transport or GraphQL errors.
// Returns { stock: Map(variantId -> number|null), reservationsApplied }.
// If the open-drafts lookup fails the numbers are Shopify's available only
// (reservationsApplied false) rather than failing the whole lookup.
async function getStockByVariant(gql, variantIds) {
  const ids = [...new Set(variantIds)];
  const data = await gql(STOCK_QUERY, { ids });
  const where = locationId();
  const stock = new Map();
  for (const node of data.nodes) {
    if (!node) continue;
    const item = node.inventoryItem;
    if (!item || item.tracked === false) {
      stock.set(node.id, null);
      continue;
    }
    const level = item.inventoryLevels.nodes.find((l) => l.location.id === where);
    const available = level && level.quantities.find((q) => q.name === "available");
    stock.set(node.id, available ? Math.max(0, available.quantity) : 0);
  }

  let reservationsApplied = true;
  try {
    const reserved = await getReservedByVariant(gql);
    for (const [id, qty] of stock) {
      if (typeof qty === "number") stock.set(id, Math.max(0, qty - (reserved.get(id) || 0)));
    }
  } catch (err) {
    reservationsApplied = false;
    console.error("Could not read open draft orders (stock not reduced for them):", err);
  }
  return { stock, reservationsApplied };
}

module.exports = { getStockByVariant, locationId };
