#!/usr/bin/env bash
# Cloud Shell: resend the shop ship-to email for a buyer (live API).
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
print("ADMIN_PASSWORD=" + json.dumps(vals.get("ADMIN_PASSWORD", "")))
PY
)"
export ADMIN_PASSWORD

if [[ -z "${ADMIN_PASSWORD}" ]]; then
  echo "Could not read ADMIN_PASSWORD from Cloud Run as plain text."
  exit 1
fi

LOGIN="$(curl -sS -X POST "$API_URL/api/admin/login" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,os; print(json.dumps({"password": os.environ["ADMIN_PASSWORD"]}))')" )"
export LOGIN
ADMIN_TOKEN="$(python3 - <<'PY'
import json, os, sys
data = json.loads(os.environ["LOGIN"])
token = data.get("token") or ""
if not token:
    sys.exit("Admin login failed: " + os.environ["LOGIN"][:300])
print(token)
PY
)"

echo "Requesting resend for $NAME ..."
curl -sS -X POST "$API_URL/api/admin/resend-confirmation" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d "$(python3 -c 'import json,os,sys; print(json.dumps({"buyerName": sys.argv[1]}))' "$NAME")"
echo
