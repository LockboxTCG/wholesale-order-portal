"use strict";

const { google } = require("googleapis");

function loadAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  }
  const key = JSON.parse(raw);
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets.readonly",
      "https://www.googleapis.com/auth/drive.readonly"
    ]
  });
}

async function getGrid(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const firstTab = meta.data.sheets[0].properties.title;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${firstTab}'!A1:Z1000`
  });
  return res.data.values || [];
}

// Covers both common Drive share-link shapes:
//   https://drive.google.com/uc?export=view&id=<ID>        (query param)
//   https://drive.google.com/file/d/<ID>/view?usp=sharing   (path segment)
const DRIVE_ID_QUERY_RE = /[?&]id=([^&]+)/;
const DRIVE_ID_PATH_RE = /\/d\/([^/?]+)/;

function driveFileId(url) {
  const str = String(url || "");
  const queryMatch = str.match(DRIVE_ID_QUERY_RE);
  if (queryMatch) return queryMatch[1];
  const pathMatch = str.match(DRIVE_ID_PATH_RE);
  if (pathMatch) return pathMatch[1];
  return null;
}

const EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif"
};

async function downloadLogo(drive, logoUrl) {
  const fileId = driveFileId(logoUrl);
  if (!fileId) return null;

  const meta = await drive.files.get({ fileId, fields: "mimeType" });
  const ext = EXT_BY_MIME[meta.data.mimeType] || "png";

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return { buffer: Buffer.from(res.data), ext };
}

module.exports = { loadAuth, getGrid, downloadLogo, driveFileId };
