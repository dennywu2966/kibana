# Aliyun IAM Authentication - Validation Guide

This guide provides comprehensive instructions for validating the Aliyun IAM authentication feature for Kibana 9.2.4.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Automated Testing with Playwright](#automated-testing-with-playwright)
- [Manual Verification Checklist](#manual-verification-checklist)
- [Expected Results](#expected-results)
- [Troubleshooting](#troubleshooting)
- [Test Data Cleanup](#test-data-cleanup)

---

## Prerequisites

### Required Software
- **Node.js**: v18.x or higher
- **Yarn**: v1.22+ or npm
- **Elasticsearch**: 9.x running at `localhost:9200`
- **Kibana**: 9.2.4 built from source
- **Playwright**: Installed via npm/yarn

### Elasticsearch Configuration
Ensure Elasticsearch is running with the following default credentials:
- **Username**: `elastic`
- **Password**: `Summer11`

### Aliyun IAM Requirements
For full end-to-end testing, you'll need:
- Aliyun account with RAM (Resource Access Management) enabled
- RAM user configured with appropriate permissions
- Access Key ID and Secret Access Key
-STS (Security Token Service) capability for temporary credentials

---

## Environment Setup

### 1. Start Elasticsearch

```bash
# If using Docker
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  -p 9300:9300 \
  -e "discovery.type=single-node" \
  -e "ELASTIC_PASSWORD=Summer11" \
  -e "xpack.security.enabled=true" \
  docker.elastic.co/elasticsearch/elasticsearch:9.x.x

# Or if using local installation
cd /path/to/elasticsearch
bin/elasticsearch
```

Verify ES is running:
```bash
curl -u elastic:Summer11 http://localhost:9200
```

Expected response:
```json
{
  "name": "...",
  "cluster_name": "...",
  "version": { ... },
  "tagline": "You Know, for Search"
}
```

### 2. Configure Aliyun Authentication in Elasticsearch

Add to your `elasticsearch.yml` or via API:

```yaml
xpack:
  security:
    authc:
      realms:
        aliyun:
          aliyun1:
            order: 2
            access_key_id: "${ALIYUN_ACCESS_KEY_ID}"
            access_key_secret: "${ALIYUN_ACCESS_KEY_SECRET}"
            role_key: " roleName"
```

### 3. Build and Start Kibana

```bash
cd /home/denny/projects/kibana-9.2.4

# Install dependencies
yarn kbn bootstrap

# Build Kibana
yarn kbn build

# Start Kibana in development mode
yarn start --kibana-xpack-security-aliyunenabled=true
```

Kibana should be available at `http://localhost:5601`

---

## Automated Testing with Playwright

### Install Playwright Browsers

```bash
cd /home/denny/projects/kibana-9.2.4/x-pack/platform/plugins/shared/security/test
npx playwright install --with-deps chromium
```

### Run All Tests

```bash
cd /home/denny/projects/kibana-9.2.4/x-pack/platform/plugins/shared/security/test

# Set Kibana URL if different from default
export KIBANA_URL="http://localhost:5601"

# Run all tests
npx playwright test

# Run tests with UI
npx playwright test --ui

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run specific test file
npx playwright test auth_aliyun_validation.spec.ts

# Run specific test
npx playwright test -g "should display Aliyun login option"
```

### View Test Reports

After running tests, view the HTML report:
```bash
npx playwright show-report
```

### Test Coverage

The automated tests cover:
1. **Login Page UI Tests**
   - Aliyun button visibility
   - Card title and hint display
   - Multiple authentication providers
   - Loading states

2. **Authentication Flow Tests**
   - Basic login for admin access
   - Role mapping UI access
   - Mock authentication flow
   - Error handling

3. **API Validation Tests**
   - Authentication endpoint availability
   - Header handling validation
   - Security settings access

---

## Manual Verification Checklist

### Phase 1: Login Page Verification

#### Step 1.1: Access Login Page
1. Navigate to `http://localhost:5601`
2. Expected: Login page loads successfully
3. Verify: No console errors in browser DevTools

#### Step 1.2: Check Login Selector
1. Look for the login selector panel
2. Expected: Multiple authentication options displayed
3. Verify: "Log in with basic/basic1" card is visible
4. Verify: "Log in with aliyun/aliyun1" card is visible

#### Step 1.3: Inspect Aliyun Card
1. Locate the Aliyun authentication card
2. Expected elements:
   - Icon (Aliyun logo or cloud icon)
   - Title: "Aliyun" or "Log in with aliyun/aliyun1"
   - Hint text containing "RAM" or "Resource Access Management"
3. Verify: Card has `data-test-subj="loginCard-aliyun/aliyun1"`
4. Verify: Card is clickable and enabled

### Phase 2: Admin Login for Role Mapping UI

#### Step 2.1: Login as Admin
1. Click on "Log in with basic/basic1" or use username/password form
2. Enter credentials:
   - Username: `elastic`
   - Password: `Summer11`
3. Click "Log in"
4. Expected: Successful login, redirect to home page
5. Verify: User menu button appears in top right

#### Step 2.2: Access Stack Management
1. Click on the hamburger menu (☰) or navigate to Management
2. Click "Stack Management"
3. Expected: Stack Management page loads
4. Verify: "Security" section is visible

#### Step 2.3: Access Security Settings
1. Click on "Security" in the left sidebar
2. Look for "Aliyun Role Mappings" or similar
3. Expected: Role mapping management link is visible
4. Note: If not implemented yet, this is expected

### Phase 3: Aliyun Authentication Flow (Optional)

#### Step 3.1: Initiate Aliyun Login
1. Logout from current session
2. Return to login page
3. Click on "Log in with aliyun/aliyun1"
4. Expected: Loading spinner appears

#### Step 3.2: Observe Authentication Flow
Without valid Aliyun credentials:
- Expected: Error message displayed or redirect to Aliyun login
- Verify: Appropriate error handling

With valid Aliyun credentials (if configured):
- Expected: Redirect to Aliyun authentication page
- After authentication: Redirect back to Kibana
- Verify: User is logged in with appropriate permissions

### Phase 4: Role Mapping Validation (If Implemented)

#### Step 4.1: Create Role Mapping
1. Access Aliyun Role Mappings page
2. Click "Create role mapping"
3. Fill in:
   - Role name: `aliyun_admin`
   - RAM role ARN or pattern
   - Kibana role to assign
4. Click "Create"
5. Expected: Success notification

#### Step 4.2: Test Role Mapping
1. Login with Aliyun user matching the mapping
2. Expected: User has permissions from mapped role
3. Verify: Access to appropriate features

---

## Expected Results

### Successful Authentication Flow

#### UI Behavior
- Login page loads within 2 seconds
- Aliyun card is visible and styled correctly
- Clicking Aliyun card shows loading state
- After authentication, user is redirected to appropriate page
- User menu shows authenticated user

#### Console/Network
- No JavaScript errors in browser console
- Authentication requests return 200 or 302
- Headers include proper authentication tokens
- Session is established and maintained

#### Backend (Elasticsearch)
- User authenticated via Aliyun provider
- Audit logs show successful authentication
- Role mappings are applied correctly
- User has appropriate permissions

### Error Scenarios

#### Invalid Credentials
- Error message displayed: "Authentication failed"
- User remains on login page
- Can retry authentication

#### Network Issues
- Appropriate error message or timeout handling
- No application crashes
- Can retry after network恢复

#### Misconfiguration
- Clear error message indicating configuration issue
- Guidance on fixing configuration
- Fallback to other authentication methods if available

---

## Troubleshooting

### Issue: Login Page Not Loading

**Symptoms**: Blank page, timeout, or connection refused

**Solutions**:
1. Verify Kibana is running: `curl http://localhost:5601`
2. Check Kibana logs for errors
3. Ensure Elasticsearch is accessible: `curl -u elastic:Summer11 http://localhost:9200`
4. Check firewall settings

### Issue: Aliyun Card Not Visible

**Symptoms**: Only basic authentication shown

**Solutions**:
1. Verify Aliyun provider is enabled in `kibana.yml`:
   ```yaml
   xpack.security.authc.aliyun.enabled: true
   ```
2. Check realm configuration in Elasticsearch
3. Restart Kibana after configuration changes
4. Check browser console for JavaScript errors

### Issue: Authentication Fails

**Symptoms**: Error message after clicking Aliyun login

**Solutions**:
1. Verify Aliyun credentials are correct
2. Check Elasticsearch logs for authentication errors
3. Verify Aliyun IAM user has appropriate permissions
4. Test with Aliyun CLI to validate credentials:
   ```bash
   aliyun sts GetCallerIdentity
   ```

### Issue: Role Mapping UI Not Accessible

**Symptoms**: Cannot find role mapping settings

**Solutions**:
1. Ensure logged in as admin (elastic user)
2. Check if role mapping UI is implemented (may be pending)
3. Verify user has appropriate permissions
4. Check browser network tab for 403/404 errors

### Issue: Tests Failing

**Symptoms**: Playwright tests fail consistently

**Solutions**:
1. Ensure Kibana is running and accessible
2. Check test configuration matches environment:
   ```bash
   export KIBANA_URL="http://localhost:5601"
   ```
3. Update selectors if UI has changed
4. Run tests in headed mode to see what's happening:
   ```bash
   npx playwright test --headed
   ```
5. Check test logs and screenshots in `test-results`

### Issue: Session Conflicts in Tests

**Symptoms**: Tests pass individually but fail when run together

**Solutions**:
1. Tests are configured to run sequentially (`workers: 1`)
2. Each test should use fresh browser context
3. Logout between tests if needed
4. Clear cookies/localStorage in beforeEach

---

## Test Data Cleanup

### Clean Up Test Role Mappings

```bash
# Delete role mappings via API
curl -u elastic:Summer11 -X DELETE \
  http://localhost:9200/_security/role_mapping/aliyun_test_mapping

# Or via Kibana Dev Tools
DELETE _security/role_mapping/aliyun_test_mapping
```

### Clean Up Test Users

```bash
# Delete test users
curl -u elastic:Summer11 -X DELETE \
  http://localhost:9200/_security/user/aliyun_test_user
```

### Reset Test Environment

1. Stop Kibana
2. Clear Kibana index:
   ```bash
   curl -u elastic:Summer11 -X DELETE \
     http://localhost:9200/.kibana*
   ```
3. Restart Kibana

---

## Performance Benchmarks

### Expected Performance Metrics

| Operation | Expected Time | Max Acceptable |
|-----------|--------------|----------------|
| Login page load | < 2s | 5s |
| Aliyun auth initiation | < 1s | 3s |
| Authentication completion | < 5s | 10s |
| Role mapping creation | < 2s | 5s |

### How to Measure

```javascript
// Use browser DevTools Performance tab
// Or use Playwright metrics
const page = await browser.newPage();
await page.goto('http://localhost:5601/login');
const metrics = await page.metrics();
console.log(metrics);
```

---

## Security Validation

### Required Security Checks

- [ ] Credentials never exposed in client-side JavaScript
- [ ] Authentication tokens stored securely (httpOnly cookies)
- [ ] HTTPS enforced in production
- [ ] CSRF protection enabled
- [ ] Session timeout configured appropriately
- [ ] Audit logging enabled for authentication events
- [ ] Rate limiting on authentication endpoints
- [ ] Input validation on all user inputs

### Test Security Headers

```bash
# Check security headers
curl -I http://localhost:5601

# Expected headers:
# - X-Frame-Options: DENY or SAMEORIGIN
# - X-Content-Type-Options: nosniff
# - Strict-Transport-Security (in production)
```

---

## Continuous Integration

### CI/CD Integration

Add to your CI pipeline:

```yaml
# .github/workflows/aliyun-auth-tests.yml
name: Aliyun Auth Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: yarn kbn bootstrap
      - name: Start Elasticsearch
        run: |
          docker run -d -p 9200:9200 \
            -e "discovery.type=single-node" \
            -e "ELASTIC_PASSWORD=Summer11" \
            docker.elastic.co/elasticsearch/elasticsearch:9.x.x
      - name: Start Kibana
        run: yarn start &
      - name: Install Playwright
        run: npx playwright install --with-deps chromium
      - name: Run tests
        run: |
          cd x-pack/platform/plugins/shared/security/test
          npx playwright test
        env:
          KIBANA_URL: http://localhost:5601
      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-results
          path: x-pack/platform/plugins/shared/security/test/playwright-report/
```

---

## Additional Resources

### Documentation Links
- [Kibana Security Documentation](https://www.elastic.co/guide/en/kibana/current/security.html)
- [Elasticsearch Security Documentation](https://www.elastic.co/guide/en/elasticsearch/reference/current/security-settings.html)
- [Aliyun RAM Documentation](https://www.alibabacloud.com/help/doc-detail/38638.htm)

### Related Files in Codebase
- `/x-pack/platform/plugins/shared/security/server/authentication/providers/aliyun.ts` - Authentication provider
- `/x-pack/platform/plugins/shared/security/server/routes/authentication/aliyun.ts` - API routes
- `/x-pack/platform/plugins/shared/security/public/authentication/login/` - Login page components

---

## Feedback and Issues

### Report Issues
When reporting issues, include:
1. Kibana and Elasticsearch versions
2. Complete error messages
3. Steps to reproduce
4. Browser and OS information
5. Test results (if applicable)

### Useful Debug Commands

```bash
# Check Kibana logs
tail -f /path/to/kibana/logs/kibana.log

# Check Elasticsearch logs
tail -f /path/to/elasticsearch/logs/elasticsearch.log

# Monitor authentication requests
curl -u elastic:Summer11 \
  http://localhost:9200/_security/_authenticate?pretty

# Check active realms
curl -u elastic:Summer11 \
  http://localhost:9200/_xpack/security/authc/realms?pretty
```

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-28 | 1.0 | Initial validation guide for Task 6 |

---

**Next Steps**: After validation is complete, proceed to Task 7 (Extensibility Implementation).
