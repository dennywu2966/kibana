#!/usr/bin/env python3
"""
API-based test for Aliyun OAuth endpoints.
Tests the OAuth flow endpoints directly without browser automation.
"""

import requests
import json
from urllib.parse import urlparse, parse_qs

KIBANA_BASE = "http://localhost:5603/kibana"

def test_security_api():
    """Test that Kibana security API is accessible."""
    print("=" * 60)
    print("Testing Kibana Security API")
    print("=" * 60)

    # Test unauthenticated /api/security/me
    response = requests.get(f"{KIBANA_BASE}/api/security/me")
    print(f"GET /api/security/me (unauthenticated): {response.status_code}")
    assert response.status_code == 401, "Should return 401 when not authenticated"
    print("✓ Correctly returns 401 for unauthenticated request")

    # Test that we can reach the base page
    response = requests.get(KIBANA_BASE, allow_redirects=True)
    print(f"\nGET {KIBANA_BASE}: {response.status_code}")
    print(f"Final URL: {response.url}")

def test_oauth_endpoints():
    """Test OAuth-related endpoints."""
    print("\n" + "=" * 60)
    print("Testing OAuth Endpoints")
    print("=" * 60)

    # Test login page availability
    response = requests.get(f"{KIBANA_BASE}/login", allow_redirects=True)
    print(f"GET /login: {response.status_code}")

    # Check for Aliyun auth configuration
    response = requests.get(f"{KIBANA_BASE}/api/security/configuration")
    print(f"GET /api/security/configuration: {response.status_code}")
    if response.status_code == 200:
        try:
            config = response.json()
            # Check for Aliyun provider
            if 'authentication' in str(config).lower():
                print("✓ Authentication configuration found")
            # Look for aliyun references
            content = json.dumps(config)
            if 'aliyun' in content.lower():
                print("✓ Aliyun provider found in configuration")
                # Try to extract relevant info
                print(f"  Config keys: {list(config.keys()) if isinstance(config, dict) else 'N/A'}")
        except:
            print("  Could not parse configuration JSON")

def test_oauth_initiation():
    """Test OAuth initiation endpoint."""
    print("\n" + "=" * 60)
    print("Testing OAuth Initiation")
    print("=" * 60)

    # The OAuth initiation should be at /api/security/aliyun/sso
    oauth_url = f"{KIBANA_BASE}/api/security/aliyun/sso"
    print(f"Testing: {oauth_url}")

    response = requests.get(oauth_url, allow_redirects=False)
    print(f"Response status: {response.status_code}")

    # Check for redirect
    if response.status_code in (302, 301):
        location = response.headers.get('Location', '')
        print(f"✓ Redirects to: {location[:100]}...")

        # Check if it redirects to Aliyun
        if 'aliyun' in location.lower() or 'signin' in location.lower():
            print("✓ Correctly redirects to Aliyun login")
        else:
            print(f"⚠ Warning: Unexpected redirect location")
    elif response.status_code == 401:
        print("✓ Endpoint exists (401 may be expected)")
    else:
        print(f"Response body: {response.text[:200]}")

    # Also try the callback URL pattern
    callback_url = f"{KIBANA_BASE}/api/security/aliyun/callback"
    print(f"\nTesting callback endpoint: {callback_url}")
    response = requests.get(callback_url, allow_redirects=False)
    print(f"Callback response: {response.status_code}")

def test_kibana_routes():
    """Test Kibana's route configuration."""
    print("\n" + "=" * 60)
    print("Testing Kibana Internal Routes")
    print("=" * 60)

    # Try to get the login page HTML
    response = requests.get(f"{KIBANA_BASE}/login")
    print(f"GET /login: {response.status_code}")

    if response.status_code == 200:
        content = response.text
        # Check for OAuth-related content
        if 'aliyun' in content.lower():
            print("✓ Aliyun mentioned in login page")
        # Check for OAuth buttons
        if 'oauth' in content.lower() or 'sso' in content.lower():
            print("✓ OAuth/SSO mentioned in login page")

        # Look for form actions
        import re
        actions = re.findall(r'action="([^"]*)"', content)
        if actions:
            print(f"Form actions found: {actions}")

def main():
    """Run all tests."""
    print("Aliyun OAuth API Test Suite")
    print(f"Target: {KIBANA_BASE}\n")

    try:
        test_security_api()
        test_oauth_endpoints()
        test_oauth_initiation()
        test_kibana_routes()

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print("All endpoint tests completed!")
        print("Check the output above for any issues.")

        print("\n📝 NOTES:")
        print("- These tests verify the OAuth endpoints are accessible")
        print("- Full OAuth flow requires browser interaction")
        print("- Use the manual browser test for complete validation")

    except requests.exceptions.ConnectionError:
        print("\n❌ ERROR: Cannot connect to Kibana")
        print(f"   Ensure Kibana is running at {KIBANA_BASE}")
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()
