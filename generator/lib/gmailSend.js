"use strict";

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error("Could not mint a Gmail access token: " + JSON.stringify(data));
  }
  return data.access_token;
}

// RFC 2047 encoded-word: message headers (unlike the body) are ASCII-only by
// default, so a raw non-ASCII character in the Subject line would render as
// mojibake in Gmail.
function encodeHeader(str) {
  return "=?UTF-8?B?" + Buffer.from(str, "utf8").toString("base64") + "?=";
}

function buildRawEmail({ to, from, subject, body, messageId, inReplyTo, references }) {
  const lines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${encodeHeader(subject)}`
  ];
  if (messageId) lines.push(`Message-ID: ${messageId}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("Content-Type: text/plain; charset=UTF-8", "MIME-Version: 1.0", "", body);

  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sendEmail({ accessToken, raw, threadId }) {
  const body = { raw };
  if (threadId) body.threadId = threadId;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("Gmail send failed: " + JSON.stringify(data));
  }
  return data; // { id, threadId, labelIds }
}

module.exports = { getAccessToken, buildRawEmail, sendEmail, encodeHeader };
