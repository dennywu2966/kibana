# Quick Reference: Running Aliyun Auth Tests

## Prerequisites Check

```bash
# 1. Check Elasticsearch is running
curl -u elastic:Summer11 http://localhost:9200

# 2. Check Kibana is running
curl http://localhost:5601

# 3. Navigate to test directory
cd /home/denny/projects/kibana-9.2.4/x-pack/platform/plugins/shared/security/test
```

## Install Playwright (First Time Only)

```bash
npx playwright install --with-deps chromium
```

## Run Tests

```bash
# Run all tests
npx playwright test

# Run with UI mode (recommended for debugging)
npx playwright test --ui

# Run specific test file
npx playwright test auth_aliyun_validation.spec.ts

# Run specific test
npx playwright test -g "should display Aliyun login option"

# Run in headed mode (see browser)
npx playwright test --headed

# Run with debug mode
npx playwright test --debug
```

## View Results

```bash
# Open HTML report
npx playwright show-report

# View test results
ls -la test-results/
```

## Troubleshooting

```bash
# If tests fail, check Kibana logs
tail -f /path/to/kibana/logs/kibana.log

# Run specific test with more details
npx playwright test --reporter=list

# Update Playwright if needed
npx playwright install --force chromium
```

## Common Issues

**Issue**: Tests fail with "Kibana not accessible"
**Fix**: Make sure Kibana is running at http://localhost:5601

**Issue**: Aliyun card not visible
**Fix**: Check that Aliyun authentication is enabled in config

**Issue**: Session conflicts
**Fix**: Tests are configured to run sequentially with workers: 1

For more details, see VALIDATION-GUIDE.md in repository root.
