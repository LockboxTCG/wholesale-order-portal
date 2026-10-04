"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const { loadAuth, getGrid, downloadLogo } = require("./lib/sheets");
const { parseCatalog, parseTierThresholds } = require("./lib/parsePricing");
const { parseCustomers } = require("./lib/parseCustomers");
const { parsePriceOverrides, applyPriceOverrides } = require("./lib/priceOverrides");
const { attachProductLinks } = require("./lib/productLinks");
const { TEST_PORTALS } = require("./lib/testPortals");
const { customerSlug } = require("./lib/slug");
const { renderPage } = require("./lib/renderPage");
const { isSendDay } = require("./lib/emailSchedule");

const ROOT = path.join(__dirname, "..");
const DEPLOY_DIR = path.join(ROOT, "deploy");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  // The workflow's cron fires every Monday (cron can't express "Nth Monday
  // of the month" directly), so on a scheduled run this only actually
  // regenerates/deploys on a real send day - matching the monthly email
  // schedule, so the site isn't rebuilt on Mondays that don't matter. A
  // manual run (workflow_dispatch, or running this locally) always
  // proceeds regardless, since that's for on-demand testing/regeneration
  // after a sheet edit.
  if (process.env.TRIGGER_EVENT === "schedule" && !isSendDay(new Date())) {
    console.log(`Today is not a scheduled send day — skipping regeneration (event: ${process.env.TRIGGER_EVENT}).`);
    // No deploy/ directory gets created below when skipping, so the
    // workflow's later steps (manifest upload, Vercel deploy) need to know
    // to skip too rather than fail on a missing directory.
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "skipped=true\n");
    }
    return;
  }

  const PRICING_SHEET_ID = requireEnv("PRICING_SHEET_ID");
  const CUSTOMER_SHEET_ID = requireEnv("CUSTOMER_SHEET_ID");
  const PORTAL_SLUG_SECRET = requireEnv("PORTAL_SLUG_SECRET");
  const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://wholesale.lockboxtcg.com";

  const auth = loadAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  console.log("Fetching pricing sheet…");
  const pricingGrid = await getGrid(sheets, PRICING_SHEET_ID);
  const linkedCatalog = attachProductLinks(parseCatalog(pricingGrid));
  const catalog = linkedCatalog.catalog;
  for (const name of linkedCatalog.missing) {
    console.warn(`No product page link for "${name}" - add it to generator/lib/productLinks.json.`);
  }
  const tierThresholds = parseTierThresholds(pricingGrid);
  console.log(
    `Parsed ${catalog.length} categories, ${catalog.reduce((n, c) => n + c.products.length, 0)} products.`
  );

  console.log("Fetching customer directory…");
  const customerGrid = await getGrid(sheets, CUSTOMER_SHEET_ID);
  const customers = parseCustomers(customerGrid);
  console.log(`Parsed ${customers.length} customers.`);
  customers.push(...TEST_PORTALS.map((t) => ({ ...t })));
  console.log(`Added ${TEST_PORTALS.length} test portal(s) (not real customers).`);

  // Fail loudly on a slug collision (e.g. duplicate business names) rather
  // than silently letting two customers share one unlisted URL.
  const seenSlugs = new Map();
  for (const c of customers) {
    const slug = customerSlug(c.businessName, PORTAL_SLUG_SECRET);
    if (seenSlugs.has(slug)) {
      throw new Error(
        `Slug collision between "${seenSlugs.get(slug)}" and "${c.businessName}" — ` +
          "rename one of them in the customer directory sheet."
      );
    }
    seenSlugs.set(slug, c.businessName);
    c.slug = slug;
  }

  fs.rmSync(DEPLOY_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });

  copyDir(path.join(ROOT, "shared"), path.join(DEPLOY_DIR, "shared"));
  copyDir(path.join(ROOT, "api"), path.join(DEPLOY_DIR, "api"));
  fs.copyFileSync(path.join(ROOT, "vercel.deploy.package.json"), path.join(DEPLOY_DIR, "package.json"));

  const monthLabel = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  const manifestRows = ["Business name,Slug,URL"];

  for (const c of customers) {
    const customerDir = path.join(DEPLOY_DIR, "c", c.slug);
    fs.mkdirSync(customerDir, { recursive: true });

    let logoPath = null;
    if (c.logoUrl) {
      try {
        const logo = await downloadLogo(drive, c.logoUrl);
        if (logo) {
          const fileName = "logo." + logo.ext;
          fs.writeFileSync(path.join(customerDir, fileName), logo.buffer);
          logoPath = `/c/${c.slug}/${fileName}`;
        } else {
          console.warn(
            `Could not parse a Drive file ID out of the Logo URL for "${c.businessName}": ${c.logoUrl}`
          );
        }
      } catch (err) {
        console.warn(`Could not download logo for "${c.businessName}": ${err.message}`);
      }
    }

    let customerCatalog = catalog;
    if (c.priceOverridesRaw) {
      try {
        const overrides = parsePriceOverrides(c.priceOverridesRaw);
        customerCatalog = applyPriceOverrides(catalog, overrides, c.businessName);
      } catch (err) {
        console.warn(`Skipping price overrides for "${c.businessName}": ${err.message}`);
      }
    }

    const html = renderPage({
      customerName: c.businessName,
      customerEmail: c.contactEmail,
      monthLabel,
      slug: c.slug,
      logoPath,
      catalog: customerCatalog,
      tierThresholds
    });
    fs.writeFileSync(path.join(customerDir, "index.html"), html);

    manifestRows.push(`"${c.businessName.replace(/"/g, '""')}",${c.slug},${SITE_ORIGIN}/c/${c.slug}/`);
    console.log(`Built ${c.businessName} → /c/${c.slug}/${logoPath ? "" : " (no logo)"}`);
  }

  fs.writeFileSync(path.join(DEPLOY_DIR, "_manifest.csv"), manifestRows.join("\n") + "\n");

  console.log(`\nDone. ${customers.length} customer pages written to ${DEPLOY_DIR}`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "skipped=false\n");
  }
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
