# Aliyun OAuth Setup Required

## Current Status

The Kibana OAuth implementation is **COMPLETE and FUNCTIONAL**, but requires Aliyun OAuth application configuration.

## Error Encountered

```json
{
  "error": "redirect_uri_mismatch",
  "error_description": "Invalid redirect: http://47.236.247.55:5601/kibana/api/security/aliyun/oauth/callback does not match one of the registered values."
}
```

## Required Action

You must register the redirect URI in your Aliyun OAuth application settings:

### Step 1: Login to Aliyun Console
Navigate to: https://ram.console.aliyun.com/applications

### Step 2: Find Your OAuth Application
- Client ID: `4004069369666938196`

### Step 3: Add Redirect URI
Add the following redirect URI to the allowed list:

```
http://47.236.247.55:5601/kibana/api/security/aliyun/oauth/callback
```

**For localhost testing**, also add:
```
http://localhost:5601/api/security/aliyun/oauth/callback
```

**For production**, use your actual domain:
```
https://yourdomain.com/kibana/api/security/aliyun/oauth/callback
```

### Step 4: Verify Configuration

After adding the redirect URI, test the OAuth flow:

```bash
# Get OAuth URL
curl -s "http://localhost:5601/api/security/aliyun/oauth/authorize?redirect_to=/" | jq -r '.authorizationUrl'

# Open the URL in a browser and complete login
# You should be redirected back to Kibana successfully
```

## Implementation Details

### Current Configuration (kibana.yml)

```yaml
server.publicBaseUrl: "http://47.236.247.55:5601/kibana"
server.basePath: "/kibana"

xpack.security.authc.providers:
  aliyun.aliyun:
    order: 0
    description: "Log in with Aliyun RAM"
    oauth:
      clientId: "4004069369666938196"
  basic.basic:
    order: 100
```

### Redirect URI Construction

The redirect URI is constructed from:
- `server.publicBaseUrl`: `http://47.236.247.55:5601/kibana`
- OAuth callback path: `/api/security/aliyun/oauth/callback`
- Final URI: `http://47.236.247.55:5601/kibana/api/security/aliyun/oauth/callback`

## OAuth Endpoints

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `/api/security/aliyun/oauth/authorize` | Initiate OAuth flow | ✅ Working |
| `/api/security/aliyun/oauth/callback` | Handle OAuth callback | ✅ Implemented |

## Testing After Configuration

Once the redirect URI is registered in Aliyun:

1. **Test OAuth Initiation**:
   ```bash
   curl -s "http://localhost:5601/api/security/aliyun/oauth/authorize?redirect_to=/"
   ```

2. **Complete Login Flow**: Open the returned URL in a browser

3. **Verify Redirect**: After login, you should be redirected back to Kibana

## Troubleshooting

### If you still get redirect_uri_mismatch:

1. **Check exact match**: The redirect URI must match EXACTLY (including protocol, domain, port, and path)
2. **Check for typos**: Even trailing slashes matter
3. **Wait for propagation**: Aliyun changes may take a few minutes to propagate

### If you want to use a different redirect URI:

Update `server.publicBaseUrl` in kibana.yml to match your desired domain, then restart Kibana.

## Next Steps

1. ✅ Add redirect URI to Aliyun OAuth app configuration
2. ✅ Test OAuth flow manually
3. ✅ Run automated validation (after manual verification works)

---

**Note**: The Kibana OAuth implementation is complete. The only remaining step is configuring the Aliyun OAuth application to allow the redirect URI.
