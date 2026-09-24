#!/usr/bin/env bash
# Cloud Shell: find a Square order by buyer name and trigger the shop ship-to email.
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
token = ""
square_env = "production"
for e in env:
    name = e.get("name")
    val = e.get("value") or ""
    if name == "SQUARE_ACCESS_TOKEN":
        token = val
    if name == "SQUARE_ENVIRONMENT" and val:
        square_env = val
print("TOKEN=" + json.dumps(token))
print("SQUARE_ENV=" + json.dumps(square_env))
PY
)"

if [[ -z "${TOKEN}" ]]; then
  echo "Could not read SQUARE_ACCESS_TOKEN from Cloud Run as plain text."
  exit 1
fi

HOST="https://connect.squareup.com"
if [[ "$SQUARE_ENV" == "sandbox" ]]; then
  HOST="https://connect.squareupsandbox.com"
fi

export TOKEN HOST
export NEEDLE
NEEDLE="$(python3 -c 'import sys; print(sys.argv[1].strip().lower())' "$NAME")"
ORDER_ID="$(python3 - <<'PY'
import json, os, sys, urllib.request
host, token, needle = os.environ["HOST"], os.environ["TOKEN"], os.environ["NEEDLE"]
body = {
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
with urllib.request.urlopen(req) as resp:
  data = json.loads(resp.read().decode())
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
print(best[0])
print("Matched", best[2], file=sys.stderr)
PY
)"

echo "Sending shop confirmation for $ORDER_ID ..."
curl -sS -X POST "$API_URL/api/orders/${ORDER_ID}/send-confirmation"
echo
