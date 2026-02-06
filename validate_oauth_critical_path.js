#!/usr/bin/env node

/**
 * Validates the critical OAuth authentication path for Aliyun SSO integration.
 *
 * This script:
 * 1. Reads AK/SK from ~/.oss/credentials.json
 * 2. Attempts to obtain an OAuth access token
 * 3. Validates the token with userinfo endpoint
 * 4. Tests ES authentication with the token
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  console.log(`\n${colors.cyan}=== ${step}: ${message} ===${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

// Read credentials from ~/.oss/credentials.json
function readCredentials() {
  const credsPath = path.join(process.env.HOME, '.oss', 'credentials.json');
  logStep('1', 'Reading Aliyun Credentials');

  if (!fs.existsSync(credsPath)) {
    logError(`Credentials file not found: ${credsPath}`);
    return null;
  }

  try {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    logSuccess(`Found credentials for region: ${creds.region}`);
    log(`  Access Key ID: ${creds.access_key_id.substring(0, 12)}...`);
    log(`  Endpoint: ${creds.endpoint}`);
    return creds;
  } catch (error) {
    logError(`Failed to read credentials: ${error.message}`);
    return null;
  }
}

/**
 * Makes an HTTPS request
 */
function makeRequest(url, options, data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const req = protocol.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, headers: res.headers, body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

/**
 * STEP 1: Get OAuth access token using AK/SK
 *
 * NOTE: Aliyun OAuth 2.1 typically requires:
 * - OAuth 2.1 Client Credentials Flow (for service accounts)
 * - OR authorization code flow (for user login with redirect)
 *
 * The AK/SK from ~/.oss/credentials.json are for OSS API access, not OAuth.
 * To get an OAuth token, we need to use the OAuth 2.1 token endpoint with
 * proper OAuth client credentials (not the same as AK/SK).
 */
async function getOAuthToken(creds) {
  logStep('2', 'Attempting to Get OAuth Token');

  logWarning('AK/SK credentials are for OSS API access, not OAuth 2.1');
  log('OAuth tokens require OAuth 2.1 client credentials obtained from:');
  log('  - Aliyun RAM console (create OAuth application)');
  log('  - Or via SAML/OIDC federation');

  // Try the OAuth 2.1 token endpoint with AK/SK (may not work)
  log('\nTrying OAuth token endpoint with AK/SK...');

  const tokenEndpoint = 'https://oauth.aliyun.com/v1/token';

  // OAuth 2.1 client credentials flow
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.access_key_id,
    client_secret: creds.access_key_secret,
  });

  try {
    const response = await makeRequest(tokenEndpoint + '?' + params.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (response.statusCode === 200 && response.body.access_token) {
      logSuccess('Obtained OAuth access token!');
      log(`  Token type: ${response.body.token_type}`);
      log(`  Expires in: ${response.body.expires_in}s`);
      log(`  Access token: ${response.body.access_token.substring(0, 20)}...`);
      return response.body.access_token;
    } else {
      logError(`Failed to get token: ${response.statusCode}`);
      log(`  Response: ${JSON.stringify(response.body, null, 2)}`);
      return null;
    }
  } catch (error) {
    logError(`Request failed: ${error.message}`);
    return null;
  }
}

/**
 * STEP 2: Validate token with userinfo endpoint
 */
async function validateTokenWithUserinfo(accessToken) {
  logStep('3', 'Validating Token with Userinfo Endpoint');

  const userinfoEndpoint = 'https://oauth.aliyun.com/v1/userinfo';

  try {
    const response = await makeRequest(userinfoEndpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (response.statusCode === 200) {
      logSuccess('Token validated successfully!');
      log('  Userinfo response:');
      log(JSON.stringify(response.body, null, 2));

      // Extract key fields
      const userInfo = response.body;
      log('\nExtracted identity:');
      log(`  Account ID (aid): ${userInfo.aid || userInfo.sub?.split(':')[0]}`);
      log(`  User ID (uid): ${userInfo.uid}`);
      log(`  Username (upn): ${userInfo.upn}`);
      log(`  Type: ${userInfo.type}`);

      // Build expected ARN
      const accountId = userInfo.aid || userInfo.sub?.split(':')[0];
      const userName = userInfo.upn || userInfo.sub;
      const arn = `acs:ram::${accountId}:user/${userName}`;
      log(`  Expected ARN: ${arn}`);

      return { userInfo, arn };
    } else {
      logError(`Validation failed: ${response.statusCode}`);
      log(`  Response: ${JSON.stringify(response.body, null, 2)}`);
      return null;
    }
  } catch (error) {
    logError(`Request failed: ${error.message}`);
    return null;
  }
}

/**
 * STEP 3: Test ES authentication
 */
async function testElasticsearchAuth(accessToken) {
  logStep('4', 'Testing Elasticsearch Authentication');

  // Try different ES endpoints
  const esHosts = [
    'http://localhost:9200',
    'http://127.0.0.1:9200',
  ];

  for (const host of esHosts) {
    try {
      log(`Trying ES at ${host}...`);

      const response = await makeRequest(`${host}/_security/_authenticate`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.statusCode === 200) {
        logSuccess('ES Authentication successful!');
        log('  Authenticated user:');
        log(JSON.stringify(response.body, null, 2));
        return response.body;
      } else {
        logWarning(`ES returned ${response.statusCode}`);
        log(`  Response: ${JSON.stringify(response.body, null, 2)}`);
      }
    } catch (error) {
      log(`  Connection failed: ${error.message}`);
    }
  }

  logError('Could not connect to Elasticsearch');
  log('  Make sure ES is running with the Cloud IAM realm configured');
  return null;
}

/**
 * Main execution
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  log('Aliyun OAuth Critical Path Validation', 'cyan');
  console.log('='.repeat(60));

  // Read credentials
  const creds = readCredentials();
  if (!creds) {
    logError('Cannot proceed without credentials');
    process.exit(1);
  }

  // Try to get OAuth token
  const token = await getOAuthToken(creds);
  if (!token) {
    logError('\nCannot proceed without OAuth token');
    log('\nTo get a valid OAuth token, you need to:');
    log('  1. Create an OAuth 2.1 application in Aliyun RAM console');
    log('  2. Configure callback URL for your Kibana instance');
    log('  3. Complete the OAuth authorization flow');
    log('\nAlternatively, you can manually provide a token:');
    log('  node validate_oauth_critical_path.js --token <your-token-here>');
    process.exit(1);
  }

  // Validate with userinfo
  const validation = await validateTokenWithUserinfo(token);
  if (!validation) {
    logError('Token validation failed');
    process.exit(1);
  }

  // Test ES authentication
  const esAuth = await testElasticsearchAuth(token);

  // Summary
  console.log('\n' + '='.repeat(60));
  log('Validation Summary', 'cyan');
  console.log('='.repeat(60));

  if (token && validation) {
    logSuccess('OAuth Token: Valid');
    logSuccess('Userinfo Endpoint: Accessible');
  }

  if (esAuth) {
    logSuccess('ES Authentication: Working');
    log(`  Authenticated as: ${esAuth.username}`);
    log(`  Roles: ${esAuth.roles?.join(', ') || 'none'}`);
  } else {
    logWarning('ES Authentication: Could not verify');
    log('  (ES may not be running or Cloud IAM realm not configured)');
  }

  console.log('='.repeat(60) + '\n');
}

// Allow manual token input
const tokenArg = process.argv.find(arg => arg.startsWith('--token='));
if (tokenArg) {
  const manualToken = tokenArg.split('=')[1];
  logStep('Manual', 'Using manually provided token');
  log(`Token: ${manualToken.substring(0, 20)}...`);

  validateTokenWithUserinfo(manualToken)
    .then(result => {
      if (result) {
        return testElasticsearchAuth(manualToken);
      }
    })
    .finally(() => console.log('\nValidation complete.\n'));
} else {
  main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  });
}
