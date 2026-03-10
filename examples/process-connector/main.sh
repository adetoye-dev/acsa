#!/bin/sh
set -eu

payload=$(cat)

# Use jq if available for robust JSON parsing, otherwise fall back to Python
if command -v jq >/dev/null 2>&1; then
    message=$(printf '%s' "$payload" | jq -r '.inputs.message // "missing"')
    printf '%s\n' "$(jq -n --arg echoed "$message" '{echoed:$echoed}')"
else
    printf '%s' "$payload" | python3 -c "import json, sys; payload = json.loads(sys.stdin.read()); print(json.dumps({'echoed': payload.get('inputs', {}).get('message', 'missing')}))"
fi
