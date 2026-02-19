#!/bin/bash

echo "=== Verifying ES Connection ==="
ES_URL="http://localhost:9200"

# Test connection with curl
RESULT=$(curl -s -w "\n%{http_code}" -u "elastic:Summer11" "$ES_URL" 2>&1)
HTTP_CODE=$(echo "$RESULT" | tail -1)
BODY=$(echo "$RESULT" | head -n -1)

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ ES is accessible with elastic:Summer11"

    # Now update Kibana config
    echo ""
    echo "=== Updating Kibana Config ==="

    KIBANA_YML="/home/denny/projects/kibana-9.2.4/config/kibana.yml"

    # Update elasticsearch.hosts to HTTP
    sed -i 's|elasticsearch.hosts: \["https://.*"\]|elasticsearch.hosts: ["http://localhost:9200"]|' "$KIBANA_YML"

    # Update kibana_system user password
    # First, let's change it via ES API
    echo "Changing kibana_system password..."
    curl -s -u "elastic:Summer11" -X POST "http://localhost:9200/_security/user/kibana_system/_password" \
      -H "Content-Type: application/json" \
      -d '{"password": "K1-GrRXIGdTpEU7IPxZM"}'

    # Update username/password in kibana.yml
    sed -i 's|elasticsearch.username:.*|elasticsearch.username: "elastic"|' "$KIBANA_YML"
    sed -i 's|elasticsearch.password:.*|elasticsearch.password: "Summer11"|' "$KIBANA_YML"

    echo "✓ Kibana config updated"
    echo ""
    echo "=== Config Summary ==="
    grep -E "elasticsearch.hosts|elasticsearch.username|elasticsearch.password|server.publicBaseUrl" "$KIBANA_YML"
else
    echo "✗ ES connection failed!"
    echo "Please check ES status"
fi
