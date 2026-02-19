# Kibana "Elastic did not load properly" Issue - Fix Summary

## Issue
After Aliyun OAuth login, Kibana shows: "Elastic did not load properly. Please reload this page."

## Root Causes Found

### 1. Port Mismatch (FIXED)
- `server.publicBaseUrl` was set to `http://47.236.247.55:5601/kibana`
- But Kibana was running on port **5603**
- **Fixed**: Updated to `http://47.236.247.55:5603/kibana`

### 2. Multiple Kibana Instances (FIXED)
- Old instance on port 5601 (PID 455967) - **Killed**
- New instance on port 5603 (PID 472545) - **Active**

## Configuration Changes Made

### kibana.yml
```yaml
# Changed from:
server.publicBaseUrl: "http://47.236.247.55:5601/kibana"

# To:
server.publicBaseUrl: "http://47.236.247.55:5603/kibana"
```

## Next Steps

### 1. Restart Kibana
```bash
# Kill the current Kibana process
kill 472545

# Start Kibana again
cd /home/denny/projects/kibana-9.2.4
yarn start --kibana-xpack-security-aliyunenabled=true
```

### 2. Access the Correct URL
- **Local**: http://localhost:5603/kibana
- **Public**: http://47.236.247.55:5603/kibana

### 3. Check Browser Console
If the issue persists after restart:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for JavaScript errors
4. Go to Network tab
5. Look for failed requests (red status codes)

### 4. Check Kibana Logs
```bash
tail -f /tmp/kibana-start.log
```

### 5. Verify ES Connection
```bash
curl -k -u "kibana_system:K1-GrRXIGdTpEU7IPxZM" https://127.0.0.1:9200
```

## Additional Troubleshooting

If "Elastic did not load properly" persists:

### Check .kibana Index
The authenticated user might not have a .kibana index. Login with `elastic` user first to initialize Kibana.

### Check Session Cookies
1. Open DevTools > Application > Cookies
2. Look for Kibana session cookies
3. Verify they're being set after login

### Check CORS Settings
If accessing from a different domain, CORS might be blocking requests.

## Files Modified
- `/home/denny/projects/kibana-9.2.4/config/kibana.yml` - Updated `server.publicBaseUrl`

## Processes Stopped
- Old Kibana instance on port 5601 (PID 455967)
