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
// Opens a browser tab for you to sign in and approve access, then captures
// the result on a short-lived local server (Google's older copy/paste "oob"
// flow was discontinued, so this uses the loopback redirect instead — no
// need to register any redirect URI for a Desktop-type client).

const http = require("http");
const { URL } = require("url");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

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

const server = http.createServer(async (req, res) => {
  let code;
  try {
    code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
  } catch {
    // ignore malformed requests (e.g. favicon.ico)
  }
  if (!code) {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Success — you can close this tab and return to the terminal.");
  server.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
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
    process.exitCode = 1;
  } finally {
    process.exit();
  }
});

server.listen(PORT, () => {
  console.log("\n1. Open this URL and sign in as management@lockboxtcg.com:\n");
  console.log(authUrl);
  console.log("\n2. Approve access — your browser will redirect back here automatically.\n");
});
