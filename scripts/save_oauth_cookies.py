#!/usr/bin/env python3
"""
Interactive OAuth Cookie Saver for Kibana

Launches a headed browser, waits for manual OAuth login, then saves cookies
for automated testing. Saves to kibana-auth.json in current directory.
"""

import json
import sys
import time
from pathlib import Path


def print_banner():
    print("\n" + "="*60)
    print("  Kibana OAuth Cookie Saver")
    print("="*60)
    print()


def get_target_url():
    """Get target URL from user or use default."""
    default = "http://47.236.247.55:5601"
    print(f"Target Kibana URL [default: {default}]:")
    url = input("> ").strip() or default
    return url


def get_wait_time():
    """Get wait time for manual login."""
    print("\nHow many minutes to wait for manual login? [default: 5]")
    wait = input("> ").strip() or "5"
    try:
        return int(wait) * 60 * 1000  # Convert to milliseconds
    except ValueError:
        return 5 * 60 * 1000


def generate_playwright_script(url, wait_ms, output_file):
    """Generate Playwright script for cookie saving."""
    script = f"""const {{ chromium }} = require('playwright');

(async () => {{
  const browser = await chromium.launch({{
    headless: false,
    args: ['--start-maximized']
  }});

  const context = await browser.newContext({{
    viewport: null  // Use full screen
  }});

  const page = await context.newPage();

  console.log('\\n' + '='.repeat(60));
  console.log('  BROWSER OPENED - Please complete OAuth login');
  console.log('='.repeat(60));
  console.log('\\nSteps:');
  console.log('  1. Click "Log in with Aliyun RAM"');
  console.log('  2. Enter: dongdongplanet@1437310945246567.onaliyun.com');
  console.log('  3. Password: Summer11');
  console.log('  4. Enter SMS OTP sent to: 18972952966');
  console.log('  5. Wait for redirect to Kibana home page');
  console.log('\\nWaiting', {wait_ms // 60000}, 'minutes for you to complete login...');
  console.log('\\n[INFO] Script will automatically save cookies when done.');
  console.log('[INFO] You can close the browser early to save current state.\\n');

  // Navigate to login page
  await page.goto('{url}');

  // Wait for manual login or timeout
  try {{
    await page.waitForTimeout({wait_ms});
  }} catch (e) {{
    console.log('Timeout or error:', e.message);
  }}

  // Save the storage state (cookies, localStorage, sessionStorage)
  const outputPath = '{output_file}';
  await context.storageState({{ path: outputPath }});

  console.log('\\n' + '='.repeat(60));
  console.log('  COOKIES SAVED!');
  console.log('='.repeat(60));
  console.log('\\nSaved to:', outputPath);
  console.log('\\nFile size:', require('fs').existsSync(outputPath) ? require('fs').statSync(outputPath).size + ' bytes' : 'N/A');
  console.log('\\nYou can now use this file in automated tests:');
  console.log('  const context = await browser.newContext({{');
  console.log('    storageState: \\'' + outputPath + '\\'');
  console.log('  }});\\n');

  await browser.close();
}})();
"""
    return script


def main():
    print_banner()

    # Get user input
    url = get_target_url()
    wait_ms = get_wait_time()
    output_file = "kibana-auth.json"

    # Confirm
    print("\n" + "-"*60)
    print("Configuration:")
    print(f"  URL:        {url}")
    print(f"  Wait time:  {wait_ms // 60000} minutes")
    print(f"  Output:     {Path(output_file).absolute()}")
    print("-"*60)
    print("\nPress Enter to start browser, or Ctrl+C to cancel...")
    input()

    # Generate and save script
    script = generate_playwright_script(url, wait_ms, output_file)
    script_path = Path("/tmp/save_kibana_cookies.js")
    script_path.write_text(script)

    print(f"\n[INFO] Script generated: {script_path}")
    print("[INFO] Starting browser...\n")

    # Run the script
    import subprocess
    # Run from playwright-saver directory where playwright is installed
    result = subprocess.run(["node", str(script_path)], cwd="/tmp/playwright-saver")

    # Check if file was created
    if Path(output_file).exists():
        print(f"\n[SUCCESS] Cookie file created: {output_file}")
        print(f"[INFO] File size: {Path(output_file).stat().st_size} bytes")
        print("\nUsage in Playwright:")
        print(f"""  const context = await browser.newContext({{
    storageState: '{output_file}'
  }});""")
    else:
        print(f"\n[ERROR] Cookie file not created: {output_file}")
        return 1

    return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\n[INFO] Cancelled by user.")
        sys.exit(0)
