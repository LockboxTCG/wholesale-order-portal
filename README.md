# Lockbox TCG — Wholesale Order Portal

Generates one static ordering page per wholesale customer (from two Google
Sheets) and deploys them to Vercel. A single serverless function handles
"Submit order" by creating a Gmail draft — nothing here touches Shopify.

- Pricing sheet: `(CAD) Brick & Mortar Pricing`
- Customer directory sheet: `LockboxTCG Wholesale - Customer Directory V3`
  (columns: `Business name, Contact first name, Contact email, Logo URL, Notes`)
- Live pages: `https://wholesale.lockboxtcg.com/c/<slug>/`
- No login. The unlisted URL is the access control. A customer's slug is
  derived from their business name (`generator/lib/slug.js`) and never
  changes, so you only need to send it once.

## One-time setup

You need admin access to: GitHub (to create the repo), Google Cloud Console
(as management@lockboxtcg.com, since it owns both sheets), and Vercel.

### 1. GitHub repo

Create an empty repo, then from this folder:

```bash
git init
git add .
git commit -m "Initial wholesale order portal"
git remote add origin <your-repo-url>
git push -u origin main
```

### 2. Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project (or reuse one).
2. **APIs & Services → Library**: enable the **Google Sheets API**, **Google Drive API**, and **Gmail API**.
3. **APIs & Services → Credentials → Create Credentials → Service account.**
   Give it any name (e.g. "wholesale-portal-generator"). After creating it,
   open it, go to **Keys → Add key → Create new key → JSON**, and download it.
   This file's *entire contents* become the `GOOGLE_SERVICE_ACCOUNT_KEY`
   GitHub secret below.
4. Share both Google Sheets, and the "Customer Logos" Drive folder, with the
   service account's email address (looks like
   `wholesale-portal-generator@<project>.iam.gserviceaccount.com`) as
   **Viewer**.
5. Still in Credentials, **Create Credentials → OAuth client ID → Application
   type: Desktop app.** Note the client ID and client secret.
6. Run the one-time token helper locally (needs Node — `npm install` first):
   ```bash
   npm install
   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... npm run get-gmail-token
   ```
   Open the printed URL, sign in as **management@lockboxtcg.com**, approve
   access, and paste the code back into the terminal. It prints three values
   — save them, they become Vercel env vars in step 4.

### 3. GitHub secrets and variables

In the repo's **Settings → Secrets and variables → Actions**:

**Secrets:**
| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the full JSON key file from step 2.3 |
| `PORTAL_SLUG_SECRET` | any random string (e.g. `openssl rand -hex 32`) — this is what makes customer URLs unguessable, keep it secret |
| `VERCEL_TOKEN` | from Vercel → Settings → Tokens |
| `VERCEL_ORG_ID` | from the Vercel project's Settings → General |
| `VERCEL_PROJECT_ID` | same place |

**Variables:**
| Name | Value |
|---|---|
| `PRICING_SHEET_ID` | `1-yWL9dizMm-WED0oy0yvjqGdF4rqGnLI2ZTP26zFKCg` |
| `CUSTOMER_SHEET_ID` | `1fLauy6CdgPiKCe91nbNWyee-WNMWSIiMQNb4DM4vrMc` |
| `SITE_ORIGIN` | `https://wholesale.lockboxtcg.com` |

### 4. Vercel

1. Create a new, empty Vercel project (it doesn't need to be linked to the
   GitHub repo — deploys happen from the GitHub Action via the Vercel CLI, not
   from a git push).
2. **Settings → Environment Variables**, add:
   - `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` (from step 2.6)
   - optionally `GMAIL_DRAFT_TO` if you ever want drafts addressed somewhere
     other than management@lockboxtcg.com
3. **Settings → Domains**, add `wholesale.lockboxtcg.com`, then add the CNAME
   record it gives you with your DNS provider.

### 5. First deploy

In the repo, **Actions → Generate & deploy wholesale portal → Run workflow**.
Once it finishes, check the run's artifacts for `customer-manifest` — that
CSV has every customer's business name and portal URL. That's how you find
the links to send out; nothing else surfaces them.

## How it stays up to date

The GitHub Action re-runs automatically on the 1st of every month (see
`.github/workflows/generate.yml`), re-reading both sheets and redeploying.
Add or edit a row in the Customer directory sheet, or change a price in the
pricing sheet, any time — it'll show up on the next run (or trigger the
workflow manually to push it immediately).

## Local development

```bash
npm install
GOOGLE_SERVICE_ACCOUNT_KEY="$(cat service-account.json)" \
PORTAL_SLUG_SECRET=dev-secret \
PRICING_SHEET_ID=1-yWL9dizMm-WED0oy0yvjqGdF4rqGnLI2ZTP26zFKCg \
CUSTOMER_SHEET_ID=1fLauy6CdgPiKCe91nbNWyee-WNMWSIiMQNb4DM4vrMc \
npm run generate
```

This writes `deploy/` — open any `deploy/c/<slug>/index.html` directly in a
browser (or `python3 -m http.server` from `deploy/`) to preview it. `api/`
isn't callable this way since it needs a Node serverless runtime; use
`vercel dev` from `deploy/` if you need to test Submit locally.

## What's what

- `generator/` — the Node script that reads both sheets and writes `deploy/`.
  `lib/parsePricing.js` and `lib/parseCustomers.js` are the sheet-grid
  parsers; `lib/slug.js` derives each customer's stable URL slug; the rest is
  fetching and file-writing.
- `shared/` — the actual page (styles, client-side calc/render logic, icon,
  Lockbox lockup) — identical for every customer, copied as-is into every
  deploy.
- `api/submit-order.js` — the one serverless function.
- `.github/workflows/generate.yml` — the monthly cron + manual trigger.
