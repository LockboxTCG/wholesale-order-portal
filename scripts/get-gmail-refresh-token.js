#!/usr/bin/env node
"use strict";

// One-time local helper: run this once to mint the Gmail API refresh token
// used by api/submit-order.js. You only need to do this once (refresh tokens
// don't expire from routine use). Requires an OAuth 2.0 Client of type
// "Desktop app" created in the Google Cloud project — see README.md.
//
// Usage:
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/get-gmail-refresh-token.js
//
// It prints a URL — open it, sign in as management@lockboxtcg.com, approve
// access, then paste the authorization code back into the terminal prompt.

const readline = require("readline");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars first.");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.compose"]
});

console.log("\n1. Open this URL and sign in as management@lockboxtcg.com:\n");
console.log(authUrl);
console.log("\n2. Approve access, then copy the authorization code shown.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste the authorization code here: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log("\nSuccess. Add these as Vercel environment variables:\n");
    console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    if (!tokens.refresh_token) {
      console.warn(
        "\nNo refresh_token came back — this happens if the app was already " +
          "authorized before. Go to https://myaccount.google.com/permissions, " +
          "remove this app's access, and run this script again."
      );
    }
  } catch (err) {
    console.error("Failed to exchange authorization code:", err.message);
    process.exit(1);
  }
});
