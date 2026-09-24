#!/bin/sh
# Pins the API's payload-sealing public key into apps/android/local.properties (git-ignored).
# Rebuild the app afterwards. Usage: scripts/fetch-backend-key.sh [http://127.0.0.1:54321/functions/v1/attest]
set -e
BASE="${1:-http://127.0.0.1:54321/functions/v1/attest}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROPS="$DIR/local.properties"
JSON="$(curl -fsS "$BASE/api/v1/keys")" || { echo "backend not reachable at $BASE" >&2; exit 1; }
KID="$(printf '%s' "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["kid"])')"
SPKI="$(printf '%s' "$JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["spki"])')"
touch "$PROPS"
grep -v -e '^attest\.backendKid=' -e '^attest\.backendPubKey=' "$PROPS" > "$PROPS.tmp" || true
printf 'attest.backendKid=%s\nattest.backendPubKey=%s\n' "$KID" "$SPKI" >> "$PROPS.tmp"
mv "$PROPS.tmp" "$PROPS"
echo "pinned backend key $KID into $PROPS; rebuild the app"
