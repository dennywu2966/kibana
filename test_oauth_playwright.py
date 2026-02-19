#!/usr/bin/env python3
"""
Playwright test for Aliyun OAuth login flow with Kibana.
Tests the complete OAuth flow from login page to callback.
"""

from playwright.sync_api import sync_playwright
import time

def test_aliyun_oauth_login():
    """Test Aliyun OAuth login flow."""
    base_url = "http://localhost:5603/kibana"

    with sync_playwright() as p:
        # Launch browser in non-headless mode for interactive login
        browser = p.chromium.launch(headless=False)

        try:
            context = browser.new_context()
            page = context.new_page()

            print("Navigating to Kibana login page...")
            page.goto(base_url)

            # Wait for page to load
            page.wait_for_load_state('networkidle', timeout=10000)
            print(f"Page loaded. URL: {page.url}")
            print(f"Page title: {page.title()}")

            # Take initial screenshot
            page.screenshot(path='/tmp/kibana_login.png')
            print("Screenshot saved to /tmp/kibana_login.png")

            # Look for Aliyun login button
            print("Looking for Aliyun login button...")
            try:
                # Try multiple selectors
                aliyun_button = page.locator('text=Aliyun').or_(
                    page.locator('[data-test-subj*="aliyun"]')
                ).or_(
                    page.locator('a[href*="aliyun"]')
                ).or_(
                    page.locator('button:has-text("Aliyun")')
                ).first

                if aliyun_button.count() > 0:
                    print(f"Found Aliyun button! Count: {aliyun_button.count()}")
                    # Get button info
                    for i in range(min(aliyun_button.count(), 3)):
                        print(f"  Button {i}: {aliyun_button.nth(i).get_attribute('href') or aliyun_button.nth(i).text_content()}")

                    # Click the button
                    print("Clicking Aliyun login button...")
                    aliyun_button.first.click()

                    # Wait for navigation to Aliyun
                    page.wait_for_load_state('networkidle', timeout=15000)
                    print(f"After click, URL: {page.url}")

                    # Check if we're on Aliyun login page
                    if 'aliyun' in page.url.lower() or 'signin' in page.url.lower():
                        print("SUCCESS: Redirected to Aliyun login page!")
                        page.screenshot(path='/tmp/aliyun_login_page.png')
                        print("Screenshot saved to /tmp/aliyun_login_page.png")

                        # Pause for manual login (you'll need to complete the login manually)
                        print("\n" + "="*60)
                        print("PAUSING: Please complete the Aliyun login in the browser")
                        print("Press Enter in this terminal after successful login...")
                        print("="*60)
                        input()

                        # Wait for redirect back to Kibana
                        page.wait_for_load_state('networkidle', timeout=30000)
                        print(f"After manual login, URL: {page.url}")

                        # Check if we're back at Kibana
                        if 'kibana' in page.url or page.url.startswith(base_url):
                            print("SUCCESS: Redirected back to Kibana!")
                            page.screenshot(path='/tmp/kibana_after_login.png')

                            # Check if authenticated
                            try:
                                me_response = page.request.get(f"{base_url}/api/security/me")
                                print(f"Auth check status: {me_response.status}")
                                if me_response.status == 200:
                                    user_data = me_response.json()
                                    print(f"Authenticated as: {user_data}")
                            except Exception as e:
                                print(f"Auth check error: {e}")
                    else:
                        print(f"WARNING: Not on Aliyun page. URL: {page.url}")
                        page.screenshot(path='/tmp/unexpected_page.png')

                else:
                    print("Could not find Aliyun login button")
                    print("Available buttons:")
                    buttons = page.locator('button').all()
                    for btn in buttons[:10]:
                        print(f"  - {btn.text_content()}")

                    print("Available links:")
                    links = page.locator('a').all()
                    for link in links[:10]:
                        href = link.get_attribute('href')
                        text = link.text_content()
                        if href:
                            print(f"  - {text}: {href}")

            except Exception as e:
                print(f"Error during OAuth flow: {e}")
                page.screenshot(path='/tmp/error_state.png')
                print(f"Current URL: {page.url}")

        finally:
            # Keep browser open for inspection
            print("\nPress Enter to close browser...")
            input()
            browser.close()

if __name__ == '__main__':
    test_aliyun_oauth_login()
