# Medal Art Mint — ICC Arrest Warrant Medal shop

Local rebuild of the Lovable preview shop, with **Square AU** for payments and stock, and a thin **Cloud Run** API for checkout, inventory, admin summary, and the medal register download.

## Layout

- `web/` — Vite + React + TypeScript shop (GitHub Pages)
- `api/` — Express API (Cloud Run)
- `api/templates/ICC-Netanyahu-Medal-Register.xlsx` — export template matching your existing register

## Local development

Requires Node 22+. A portable Node toolchain may already exist under `.tools/node` in this folder.

```bash
export PATH="$PWD/.tools/node/bin:$PATH"   # if using the bundled toolchain

# API (mock Square — no keys needed)
cp api/.env.example api/.env
cd api && npm install && npm run dev

# Web (new terminal)
cd web && npm install && npm run dev
```

Open http://localhost:5173

- Landing `/` → Enter Here → `/shop`
- Buy now works in mock mode and redirects to `/success`
- Admin `/admin` password defaults to `changeme` (from `api/.env`)
- **Download sheet** returns the filled register workbook

### Pointing at real Square sandbox

1. Create a Square Developer application (Australia / AUD).
2. Copy Access Token and Location ID into `api/.env`.
3. Set `MOCK_SQUARE=0` and run:

```bash
cd api && npm run setup:catalog
```

4. Paste the printed variation IDs into `api/.env`.
5. Restart the API. Checkout will create Square Payment Links with two line items (medal A$140 + donation A$140).

### Stock / gifts

- Square Inventory on the medal variation is the source of truth (start at 1000).
- Paid checkouts decrement stock automatically when the catalog item is on the order.
- If you give medals away, reduce stock in the **Square Dashboard** (Items → medal → stock). The shop “remaining” count follows Square.
- Gift **serial / name / comments** stay on the Excel register (edit after download). Dashboard stock alone does not know those details.

## Admin register export

`GET /api/admin/export` fills your existing workbook:

| Sheet | Behaviour |
|---|---|
| Medal Sales Register | Preserves existing gift rows; writes one `S` row per paid medal into the next free serials |
| Sheet1 | Org vocabulary unchanged |
| Summary | Existing COUNTIF formulas unchanged |

Columns filled for sales: Date, Sold or Gifted (`S`), Donation Recipient Organisation, Designation (buyer name if Square collected it), Comments (Square order id). **Donation Sent** and **Receipt Reference** stay blank for you to complete when donations are sent.

## Deploy

### GitHub Pages (web)

1. Push this repo to GitHub.
2. Enable Pages (GitHub Actions).
3. Set repository variable `VITE_API_BASE_URL` to your Cloud Run URL.
4. Workflow: `.github/workflows/deploy-web.yml`

Also set Vite `base` if you deploy under a project subpath.

### Cloud Run (api)

1. Create a GCP project and enable Cloud Run + Artifact Registry.
2. Store secrets listed in the deploy workflow (`SQUARE_*`, `ADMIN_*`).
3. Set repo variables `FRONTEND_BASE_URL` and `CORS_ORIGINS` to your Pages URL.
4. Configure Workload Identity Federation secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`.
5. Workflow: `.github/workflows/deploy-api.yml`

Manual deploy sketch:

```bash
cd api
gcloud run deploy mam-medal-api --source . --region australia-southeast1 --allow-unauthenticated
```

## Product pricing

- Total: **A$280** per medal
- Split on the Square order: **A$140** medal (tracked inventory) + **A$140** donation (chosen organisation)
- Max **10** medals per order
- Edition **1000**
