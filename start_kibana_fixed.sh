#!/bin/bash
# Kibana startup script with proper memory settings for optimizer

# Stop any existing Kibana instances
pkill -9 -f "kibana --dev" 2>/dev/null
sleep 2

# Set Node.js heap size to 12GB (required for optimizer to complete without OOM)
export NODE_OPTIONS="--max-old-space-size=12288"

# Start Kibana in background
cd /home/denny/projects/kibana-9.2.4
nohup yarn start > /tmp/kibana-start.log 2>&1 &

echo "Kibana starting with 8GB heap..."
echo "Monitor logs: tail -f /tmp/kibana-start.log"
echo ""
echo "Wait for: 'Kibana is now available' message"
echo "Then access: http://47.236.247.55:5601/kibana/login"
