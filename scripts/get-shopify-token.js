#!/usr/bin/env node
"use strict";

// One-time local helper: run this once to mint the Shopify Admin API access
// token used for draft-order creation and product lookups. Requires the
// custom app's Client ID/Secret from the Dev Dashboard, and a redirect URL
// of http://localhost:53683 registered on the app's "Allowed redirection
// URL(s)" (Versions → Create version → Allowed redirection URL(s)).
//
// Usage:
//   SHOPIFY_SHOP=u1hg92-rx.myshopify.com \
//   SHOPIFY_CLIENT_ID=... SHOPIFY_CLIENT_SECRET=... \
//   node scripts/get-shopify-token.js

const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const PORT = 53683;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = "read_products,write_draft_orders";

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SHOPIFY_SHOP, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const authUrl =
  `https://${SHOP}/admin/oauth/authorize?client_id=${CLIENT_ID}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&state=${state}`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  if (!code) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (returnedState !== state) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("State mismatch — possible CSRF, aborting.");
    server.close();
    console.error("State mismatch, aborting.");
    process.exit(1);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Success — you can close this tab and return to the terminal.");
  server.close();

  try {
    const tokenRes = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code
      })
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.access_token) {
      console.error("Token exchange failed:", JSON.stringify(data, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log("\nSuccess. Save this as a GitHub secret (SHOPIFY_ACCESS_TOKEN):\n");
    console.log(data.access_token);
    console.log("\nGranted scopes:", data.scope);
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
});

server.listen(PORT, () => {
  console.log("\n1. Open this URL and approve access as the store owner:\n");
  console.log(authUrl);
  console.log("\n2. Your browser will redirect back here automatically.\n");
});
