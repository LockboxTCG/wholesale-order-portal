"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "..", "template", "portal.template.html");
const template = fs.readFileSync(TEMPLATE_PATH, "utf8");

function renderPage({ customerName, monthLabel, slug, logoPath, catalog, tierThresholds }) {
  const portalData = {
    customerName,
    monthLabel,
    slug,
    logoPath: logoPath || null,
    catalog,
    tierThresholds
  };

  // JSON.stringify output is safe to inline in a <script> tag here because it
  // never contains "</script>" — escape just in case a future product name does.
  const json = JSON.stringify(portalData).replace(/</g, "\\u003c");

  return template.replace("__PORTAL_DATA_JSON__", json);
}

module.exports = { renderPage };
