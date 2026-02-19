# Aliyun IAM Authentication Tests

This directory contains Playwright E2E tests for Aliyun IAM authentication in Kibana.

## Quick Start

```bash
# Install Playwright browsers
npx playwright install --with-deps chromium

# Run tests
npx playwright test

# Run with UI mode
npx playwright test --ui

# Run specific test
npx playwright test -g "should display Aliyun login option"
```

## Environment Variables

- `KIBANA_URL`: Kibana URL (default: `http://localhost:5601`)

## Test Files

- `auth_aliyun_validation.spec.ts` - Main validation tests
- `playwright.config.ts` - Playwright configuration

## Documentation

See `/VALIDATION-GUIDE.md` in the repository root for comprehensive validation instructions.
