#!/usr/bin/env bash
# Cloud Shell: find a Square order by buyer name and POST send-confirmation.
set -euo pipefail
NAME="${1:-Leanne Barnes}"
REGION="${REGION:-australia-southeast1}"
SERVICE="${SERVICE:-mam-medal-api}"
API_URL="${API_URL:-https://mam-medal-api-151658014953.australia-southeast1.run.app}"

export CR_JSON
CR_JSON="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json)"
eval "$(python3 - <<'PY'
import json, os
d = json.loads(os.environ["CR_JSON"])
env = d["spec"]["template"]["spec"]["containers"][0].get("env") or []
vals = {}
for e in env:
    name = e.get("name")
    if name:
        vals[name] = e.get("value") or ""
print("TOKEN=" + json.dumps(vals.get("SQUARE_ACCESS_TOKEN", "")))
print("LOCATION=" + json.dumps(vals.get("SQUARE_LOCATION_ID", "")))
print("SQUARE_ENV=" + json.dumps(vals.get("SQUARE_ENVIRONMENT") or "production"))
PY
)"
export TOKEN LOCATION SQUARE_ENV

if [[ -z "${TOKEN}" || -z "${LOCATION}" ]]; then
  echo "Could not read SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID from Cloud Run."
  exit 1
fi

HOST="https://connect.squareup.com"
if [[ "$SQUARE_ENV" == "sandbox" ]]; then
  HOST="https://connect.squareupsandbox.com"
fi
export HOST
export NEEDLE
NEEDLE="$(python3 -c 'import sys; print(sys.argv[1].strip().lower())' "$NAME")"

ORDER_ID="$(python3 - <<'PY'
import json, os, sys, urllib.request
host = os.environ["HOST"]
token = os.environ["TOKEN"]
location = os.environ["LOCATION"]
needle = os.environ["NEEDLE"]
body = {
  "location_ids": [location],
  "limit": 50,
  "query": {
    "filter": {"state_filter": {"states": ["OPEN", "COMPLETED"]}},
    "sort": {"sort_field": "CREATED_AT", "sort_order": "DESC"},
  },
}
req = urllib.request.Request(
  host + "/v2/orders/search",
  data=json.dumps(body).encode(),
  headers={
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json",
    "Square-Version": "2024-12-18",
  },
  method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
except Exception as err:
    sys.exit("Square order search failed: %s" % err)
best = None
for order in data.get("orders") or []:
    name = ""
    for f in order.get("fulfillments") or []:
        rec = ((f.get("shipment_details") or {}).get("recipient") or {})
        name = (rec.get("display_name") or name or "")
    if needle in name.lower() and order.get("id"):
        created = order.get("created_at") or ""
        if not best or created > best[1]:
            best = (order["id"], created, name)
if not best:
    sys.exit("No Square order matched that buyer name.")
print("Matched %s" % best[2], file=sys.stderr)
print(best[0])
PY
)"

echo "Sending shop confirmation for $ORDER_ID ..."
curl -sS -X POST "$API_URL/api/orders/${ORDER_ID}/send-confirmation"
echo
