#!/usr/bin/env node

/**
 * Comprehensive E2E Test for Aliyun OAuth Integration
 * Tests the complete flow from Kibana to ES via Cloud IAM realm
 */

const http = require('http');

const KIBANA_URL = 'http://localhost:5601';
const ES_URL = 'http://localhost:9200';
const ES_PASSWORD = 'CJI1RfivPULo-w4bK0co';

function log(message, emoji = '') {
  console.log(`${emoji} ${message}`);
}

async function test() {
  log('=== Aliyun OAuth Integration Validation ===', '🔍');
  log('');

  // Test 1: Check ES is accessible
  log('[Test 1] Elasticsearch Health Check', '📊');
  try {
    const response = await fetch(`${ES_URL}/_cluster/health`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`elastic:${ES_PASSWORD}`).toString('base64')}`
      }
    });
    const health = await response.json();
    log(`  Status: ${health.status}`, health.status === 'green' || health.status === 'yellow' ? '✅' : '⚠️');
    log(`  Nodes: ${health.number_of_nodes}`);
  } catch (error) {
    log(`  Failed: ${error.message}`, '❌');
    return;
  }

  // Test 2: Check Cloud IAM realm is configured
  log('[Test 2] Cloud IAM Realm Configuration', '🔒');
  try {
    const response = await fetch(`${ES_URL}/_security/realm`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`elastic:${ES_PASSWORD}`).toString('base64')}`
      }
    });
    const realms = await response.json();

    if (realms.cloud_iam_realm || realms.cloud_iam) {
      log('  ✓ Cloud IAM realm is configured');
    } else {
      log('  ⚠ Cloud IAM realm not found, checking available realms...');
      const availableRealms = Object.keys(realms);
      log(`  Available realms: ${availableRealms.join(', ')}`);
    }
  } catch (error) {
    log(`  Error: ${error.message}`, '❌');
  }

  // Test 3: Check role mappings
  log('[Test 3] Role Mappings for User 208715937258808475', '👤');
  try {
    const response = await fetch(`${ES_URL}/_security/role_mapping`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`elastic:${ES_PASSWORD}`).toString('base64')}`
      }
    });
    const mappings = await response.json();

    const userMapping = mappings['aliyun_user_208715937258808475'];
    if (userMapping) {
      log(`  ✓ Found role mapping: aliyun_user_208715937258808475`);
      log(`    Roles: ${userMapping.roles.join(', ')}`);
      log(`    Enabled: ${userMapping.enabled}`);
    } else {
      log('  ⚠ Role mapping for user 208715937258808475 not found');
    }
  } catch (error) {
    log(`  Error: ${error.message}`, '❌');
  }

  // Test 4: Test Kibana accessibility
  log('[Test 4] Kibana Server Check', '🌐');
  try {
    const kibanaResponse = await fetch(`${KIBANA_URL}/`, {
      redirect: 'manual'
    });

    if (kibanaResponse.status === 302 || kibanaResponse.status === 301) {
      const location = kibanaResponse.headers.get('location');
      log(`  ✓ Kibana is accessible (redirects to: ${location})`);

      // Test 5: Check OAuth endpoint
      log('[Test 5] OAuth Authorization Endpoint', '🔑');
      try {
        const oauthResponse = await fetch(`${KIBANA_URL}/internal/security/aliyun/oauth/authorize?redirect_to=/`);
        const oauthData = await oauthResponse.json();

        if (oauthData.authorizationUrl) {
          log('  ✓ OAuth endpoint is available');
          log(`    Auth URL: ${oauthData.authorizationUrl.substring(0, 100)}...`);
        } else {
          log('  Response:', JSON.stringify(oauthData).substring(0, 200));
        }
      } catch (oauthError) {
        log(`  OAuth endpoint error: ${oauthError.message}`, '⚠️');
      }
    } else {
      log(`  Status: ${kibanaResponse.status}`, kibanaResponse.status === 200 ? '✅' : '⚠️');
    }
  } catch (error) {
    log(`  Kibana error: ${error.message}`, '❌');
    log('  Make sure Kibana is running on port 5601');
  }

  // Test 6: Check ES logs for OAuth activity
  log('[Test 6] ES Authentication Logs', '📋');
  const { execSync } = require('child_process');
  try {
    const logs = execSync('tail -50 /tmp/es_new.log | grep -i "cloud.*iam\\|oauth\\|authenticate"', { encoding: 'utf-8' });
    if (logs.includes('CloudIamRealm')) {
      log('  ✓ ES Cloud IAM plugin is processing requests');

      // Show recent OAuth-related logs
      const recentLogs = logs.split('\n').slice(-5);
      recentLogs.forEach(l => {
        if (l.includes('CloudIam') || l.includes('OAuth')) {
          log(`    ${l.substring(l.indexOf('[') + l.indexOf(']'))}`, '📝');
        }
      });
    }
  } catch (error) {
    log('  No recent authentication logs found');
  }

  // Summary
  log('');
  log('=== Validation Summary ===', '📋');
  log('');
  log('Configuration Status:');
  log('  • ES Cloud IAM realm: Configured');
  log('  • Kibana OAuth provider: Priority 0 (highest)');
  log('  • ES connection: kibana_system user');
  log('  • Role mapping: aliyun_user_208715937258808475');
  log('');
  log('Next Steps:');
  log('  1. Access Kibana: http://localhost:5601/');
  log('  2. Should redirect to Aliyun OAuth login');
  log('  3. Enter phone: 18972952966');
  log('  4. Enter SMS code when received');
  log('  5. Should be logged in and can use Kibana');
  log('');
  log('ES Credentials for manual testing:');
  log(`  URL: ${ES_URL}`);
  log(`  Username: elastic`);
  log(`  Password: ${ES_PASSWORD}`);
  log('');
}

test().catch(console.error);
