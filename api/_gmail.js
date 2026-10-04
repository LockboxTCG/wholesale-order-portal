"use strict";

// Shared Gmail helpers for the order and feedback endpoints. The leading
// underscore keeps Vercel from exposing this file as its own route.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

// RFC 2047 encoded-word: message headers (unlike the body) are ASCII-only by
// default, so a raw non-ASCII character in the Subject line would render as
// mojibake in Gmail.
function encodeHeader(str) {
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
}

function buildEmail({ to, from, subject, body, replyTo }) {
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    "",
    body
  ];
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getGmailAccessToken() {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: requireEnv("GMAIL_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: requireEnv("GMAIL_REFRESH_TOKEN")
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error("Could not mint a Gmail access token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}

async function gmailSend(accessToken, raw) {
  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ raw })
  });
  if (!sendRes.ok) {
    throw new Error("Gmail send failed: " + (await sendRes.text()));
  }
}

module.exports = { requireEnv, encodeHeader, buildEmail, getGmailAccessToken, gmailSend };
