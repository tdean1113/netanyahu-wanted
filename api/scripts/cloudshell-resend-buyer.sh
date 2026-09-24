#!/usr/bin/env bash
# Send one ship-to email for a Square buyer using Cloud Run SMTP/Resend settings.
# Does not call the live API (that path currently returns "Confirmation email failed").
set -euo pipefail
NAME="${1:-Leanne Barnes}"
ORDER_HINT="${2:-}"
REGION="${REGION:-australia-southeast1}"
SERVICE="${SERVICE:-mam-medal-api}"

export CR_JSON
CR_JSON="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json)"

# Pull Secret Manager values when Cloud Run env uses valueFrom.secretKeyRef.
while IFS=$'\t' read -r env_name secret_name; do
  [[ -z "${env_name:-}" || -z "${secret_name:-}" ]] && continue
  if [[ -z "${!env_name:-}" ]]; then
    echo "Reading secret $secret_name for $env_name ..."
    export "$env_name"="$(gcloud secrets versions access latest --secret="$secret_name")"
  fi
done < <(python3 - <<'PY'
import json, os
d = json.loads(os.environ["CR_JSON"])
for e in d["spec"]["template"]["spec"]["containers"][0].get("env") or []:
    name = e.get("name") or ""
    ref = ((e.get("valueFrom") or {}).get("secretKeyRef") or {}).get("name") or ""
    if name and ref:
        print(f"{name}\t{ref}")
PY
)

export NAME ORDER_HINT
python3 - <<'PY'
import json, os, smtplib, ssl, sys, urllib.error, urllib.request
from email.message import EmailMessage

d = json.loads(os.environ["CR_JSON"])
vals = {}
secret_backed = set()
for e in d["spec"]["template"]["spec"]["containers"][0].get("env") or []:
    name = e.get("name")
    if not name:
        continue
    if e.get("value"):
        vals[name] = e["value"]
    ref = ((e.get("valueFrom") or {}).get("secretKeyRef") or {}).get("name")
    if ref:
        secret_backed.add(name)
        if os.environ.get(name):
            vals[name] = os.environ[name]

def present(key):
    v = vals.get(key) or os.environ.get(key) or ""
    kind = "secret-ref" if key in secret_backed else ("set" if v else "missing")
    return kind

print(
    "Mail config:",
    "EMAIL_FROM=%s" % (vals.get("EMAIL_FROM") or "(empty)"),
    "SMTP_USER=%s" % (vals.get("SMTP_USER") or "(empty)"),
    "SMTP_HOST=%s" % (vals.get("SMTP_HOST") or "(empty)"),
    "RESEND_API_KEY=%s" % present("RESEND_API_KEY"),
    "SMTP_PASS=%s" % present("SMTP_PASS"),
)

token = vals.get("SQUARE_ACCESS_TOKEN") or os.environ.get("SQUARE_ACCESS_TOKEN") or ""
location = vals.get("SQUARE_LOCATION_ID") or ""
square_env = vals.get("SQUARE_ENVIRONMENT") or "production"
host = "https://connect.squareupsandbox.com" if square_env == "sandbox" else "https://connect.squareup.com"
needle = os.environ.get("NAME", "").strip().lower()
order_hint = os.environ.get("ORDER_HINT", "").strip()

if not token:
    sys.exit("No SQUARE_ACCESS_TOKEN on Cloud Run")

def square(path, method="GET", body=None):
    req = urllib.request.Request(
        host + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "Square-Version": "2024-12-18",
        },
        method=method,
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

order = None
if order_hint:
    order = square("/v2/orders/" + order_hint).get("order")
if not order:
    body = {
        "limit": 50,
        "query": {
            "filter": {"state_filter": {"states": ["OPEN", "COMPLETED"]}},
            "sort": {"sort_field": "CREATED_AT", "sort_order": "DESC"},
        },
    }
    if location:
        body["location_ids"] = [location]
    data = square("/v2/orders/search", "POST", body)
    best = None
    for o in data.get("orders") or []:
        name = ""
        for f in o.get("fulfillments") or []:
            rec = ((f.get("shipment_details") or {}).get("recipient") or {})
            name = rec.get("display_name") or name
        if needle in (name or "").lower() and o.get("id"):
            created = o.get("created_at") or ""
            if not best or created > best[0]:
                best = (created, o, name)
    if not best:
        sys.exit("No Square order matched %r" % os.environ.get("NAME"))
    order = best[1]
    print("Matched", best[2], order.get("id"))

recipient = {}
for f in order.get("fulfillments") or []:
    rec = ((f.get("shipment_details") or {}).get("recipient") or {})
    if rec:
        recipient = rec
        break
addr = recipient.get("address") or {}
who = recipient.get("display_name") or "buyer"
lines = [
    "New medal order (manual resend)",
    "Buyer: " + who,
    "Email: " + (recipient.get("email_address") or ""),
    "Phone: " + (recipient.get("phone_number") or ""),
    "Order ID: " + (order.get("id") or ""),
    "",
    addr.get("address_line_1") or "",
    addr.get("address_line_2") or "",
    " ".join(
        x
        for x in [
            addr.get("locality"),
            addr.get("administrative_district_level_1"),
            addr.get("postal_code"),
        ]
        if x
    ),
    addr.get("country") or "",
]
text = "\n".join(ln for ln in lines if ln is not None)

to_addr = "tdean1113@gmail.com"
from_addr = vals.get("EMAIL_FROM") or vals.get("SMTP_USER") or "info@netanyahuwanted.com"
if "<" in from_addr and ">" in from_addr:
    from_email = from_addr.split("<", 1)[1].split(">", 1)[0].strip()
else:
    from_email = from_addr.strip()
smtp_user = vals.get("SMTP_USER") or ""
smtp_pass = vals.get("SMTP_PASS") or os.environ.get("SMTP_PASS") or ""
smtp_host = vals.get("SMTP_HOST") or "smtp.gmail.com"
smtp_port = int(vals.get("SMTP_PORT") or "587")
resend_key = vals.get("RESEND_API_KEY") or os.environ.get("RESEND_API_KEY") or ""

msg = EmailMessage()
msg["Subject"] = "New medal order — ship to %s" % who
msg["To"] = to_addr
msg.set_content(text)

sent = False
last_err = None

def read_http_error(err):
    body = ""
    try:
        body = err.read().decode()[:800]
    except Exception:
        pass
    print("  body:", body or "(none)")

if resend_key:
    payload = {
        "from": from_addr if "@" in from_addr else from_email,
        "to": [to_addr],
        "subject": msg["Subject"],
        "text": text,
    }
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": "Bearer " + resend_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            print("Resend:", resp.status, resp.read().decode()[:500])
            sent = True
    except urllib.error.HTTPError as err:
        last_err = err
        print("Resend failed:", err.code, err.reason)
        read_http_error(err)
    except Exception as err:
        last_err = err
        print("Resend failed:", err)

if not sent:
    if not smtp_user or not smtp_pass:
        sys.exit(
            "No SMTP_USER/SMTP_PASS and Resend did not send. Last error: %s" % last_err
        )
    senders = []
    if smtp_user and "@" in smtp_user:
        senders.append(smtp_user)
    if from_email and from_email not in senders:
        senders.append(from_email)
    if "info@netanyahuwanted.com" not in senders:
        senders.append("info@netanyahuwanted.com")
    for sender in senders:
        try:
            msg.replace_header("From", sender)
        except KeyError:
            msg["From"] = sender
        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(smtp_user, smtp_pass)
                smtp.send_message(msg, from_addr=sender, to_addrs=[to_addr])
            print("SMTP sent From", sender, "To", to_addr)
            sent = True
            break
        except Exception as err:
            last_err = err
            print("SMTP failed From", sender, ":", err)
            try:
                del msg["From"]
            except Exception:
                pass

if not sent:
    sys.exit("Could not send email. Last error: %s" % last_err)
print("Done. Check tdean1113@gmail.com (inbox and spam) for ship-to %s." % who)
PY
