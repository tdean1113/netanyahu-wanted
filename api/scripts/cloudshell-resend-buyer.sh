#!/usr/bin/env bash
# Cloud Shell mail helper using Cloud Run SMTP/Resend settings.
# Default: newest paid Square order, ship-to email to tdean1113@gmail.com.
#   --thank-you  one shop confirmation to the Square buyer
#   --shop       ship-to + buyer thank-you (use this for a missed sale)
set -euo pipefail
SEND_MODE="merchant"
NAME=""
ORDER_HINT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --thank-you) SEND_MODE="thank-you"; shift ;;
    --shop) SEND_MODE="shop"; shift ;;
    --latest) NAME=""; shift ;;
    *)
      if [[ -z "$NAME" ]]; then NAME="$1"
      elif [[ -z "$ORDER_HINT" ]]; then ORDER_HINT="$1"
      fi
      shift
      ;;
  esac
done
REGION="${REGION:-australia-southeast1}"
SERVICE="${SERVICE:-mam-medal-api}"

export CR_JSON
CR_JSON="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json)"

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

export NAME ORDER_HINT SEND_MODE
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

def recipient_name(order):
    name = ""
    for f in order.get("fulfillments") or []:
        rec = ((f.get("shipment_details") or {}).get("recipient") or {})
        name = rec.get("display_name") or name
    return name

def is_paid(order):
    if order.get("tenders"):
        return True
    return order.get("state") == "COMPLETED"

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
    ranked = []
    for o in data.get("orders") or []:
        if not o.get("id"):
            continue
        ranked.append((o.get("created_at") or "", o, recipient_name(o)))
    ranked.sort(reverse=True)
    print("Recent orders:")
    for created, o, name in ranked[:8]:
        print(" ", created, o.get("id"), name or "(no name)", o.get("state"),
              "paid" if is_paid(o) else "unpaid")
    best = None
    for created, o, name in ranked:
        if needle:
            if needle not in (name or "").lower():
                continue
        elif not is_paid(o):
            continue
        best = (created, o, name)
        break
    if not best:
        sys.exit("No Square order matched %r" % (os.environ.get("NAME") or "latest paid"))
    order = best[1]
    print("Matched", best[2] or "(no name)", order.get("id"))

recipient = {}
for f in order.get("fulfillments") or []:
    rec = ((f.get("shipment_details") or {}).get("recipient") or {})
    if rec:
        recipient = rec
        break
addr = recipient.get("address") or {}
who = recipient.get("display_name") or "buyer"
buyer_email = (recipient.get("email_address") or "").strip()
send_mode = os.environ.get("SEND_MODE") or "merchant"
meta = order.get("metadata") or {}
qty = meta.get("medal_qty") or "1"
for li in order.get("line_items") or []:
    if "arrest warrant medal" in (li.get("name") or "").lower():
        qty = li.get("quantity") or qty
        break
try:
    qty_n = int(float(qty))
except Exception:
    qty_n = 1
total_cents = int((order.get("total_money") or {}).get("amount") or 28000)
total = "A$%.2f" % (total_cents / 100.0)
merchant = vals.get("MERCHANT_NAME") or "Medal Art Mint"
support = vals.get("MERCHANT_SUPPORT_EMAIL") or "info@netanyahuwanted.com"
addr_lines = [
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
addr_lines = [ln for ln in addr_lines if ln]

thank_you_text = "\n".join([
    "Thank you for your order with %s." % merchant,
    "",
    "Order: %s × ICC Arrest Warrant Medal" % qty_n,
    "Total paid: %s" % total,
    "",
    "Your contact details",
    "Name: %s" % who,
    "Email: %s" % buyer_email,
    "",
    "Delivery address",
    *(addr_lines or ["(No delivery address on file)"]),
    "",
    "Questions? Contact %s" % support,
    "",
    merchant,
])
ship_text = "\n".join(
    ln for ln in [
        "New medal order (manual resend)",
        "Buyer: " + who,
        "Email: " + buyer_email,
        "Phone: " + (recipient.get("phone_number") or ""),
        "Order ID: " + (order.get("id") or ""),
        "",
        *addr_lines,
    ] if ln is not None
)

jobs = []
if send_mode in ("merchant", "shop"):
    jobs.append((
        "tdean1113@gmail.com",
        "New medal order — ship to %s" % who,
        ship_text,
    ))
if send_mode in ("thank-you", "shop"):
    if not buyer_email or "@" not in buyer_email:
        sys.exit("Square order has no buyer email; cannot send shop thank-you.")
    jobs.append((
        buyer_email,
        "Order confirmation — ICC Arrest Warrant Medal",
        thank_you_text,
    ))

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

def read_http_error(err):
    body = ""
    try:
        body = err.read().decode()[:800]
    except Exception:
        pass
    print("  body:", body or "(none)")

def send_one(to_addr, subject, text):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["To"] = to_addr
    msg.set_content(text)
    sent = False
    last_err = None
    if resend_key:
        payload = {
            "from": from_addr if "@" in from_addr else from_email,
            "to": [to_addr],
            "subject": subject,
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
    if sent:
        return
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
            return
        except Exception as err:
            last_err = err
            print("SMTP failed From", sender, ":", err)
            try:
                del msg["From"]
            except Exception:
                pass
    sys.exit("Could not send email. Last error: %s" % last_err)

for to_addr, subject, text in jobs:
    print("Sending %r to %s" % (subject, to_addr))
    send_one(to_addr, subject, text)
print("Done. Sent", len(jobs), "message(s) for", who)
PY
