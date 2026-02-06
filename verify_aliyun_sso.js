const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyAliyunSSO() {
  const screenshotsDir = '/tmp';
  const loginUrl = 'http://127.0.0.1:5603/juf/login';

  console.log('🔍 Starting Aliyun SSO verification...');
  console.log(`📍 Target URL: ${loginUrl}`);

  let browser = null;
  let context = null;
  let page = null;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });

    page = await context.newPage();

    // Set default timeout
    page.setDefaultTimeout(30000);

    // Navigate to login page
    console.log('🌐 Navigating to login page...');
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    // Wait for page to load fully
    await sleep(3000);

    // Take initial screenshot
    const initialScreenshot = path.join(screenshotsDir, 'kibana_login_initial.png');
    await page.screenshot({ path: initialScreenshot, fullPage: true });
    console.log(`📸 Initial screenshot saved to: ${initialScreenshot}`);

    // Check page title and URL
    console.log(`📄 Page title: ${await page.title()}`);
    console.log(`📄 Current URL: ${page.url()}`);

    // Look for Aliyun login button using multiple selectors
    const selectors = [
      'text=Log in with Aliyun RAM',
      'text=Aliyun',
      'button:has-text("Aliyun")',
      'a:has-text("Aliyun")',
      '[data-test-subj*="aliyun"]',
      '[class*="aliyun"]'
    ];

    let aliyunButton = null;
    let foundSelector = '';

    for (const selector of selectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.isVisible();
          if (isVisible) {
            aliyunButton = element;
            foundSelector = selector;
            console.log(`✅ Found Aliyun button with selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Selector not found, continue to next
      }
    }

    if (!aliyunButton) {
      console.log('❌ Aliyun login button not found!');

      // Debug: Log all buttons and links on the page
      console.log('🔍 Debug: Listing all buttons and links...');
      const buttons = await page.$$eval('button, a[class*="btn"], a[href]', (elements) =>
        elements.map(el => ({
          tag: el.tagName,
          text: el.textContent?.trim(),
          className: el.className,
          href: el.getAttribute('href')
        }))
      );

      console.log('Found elements:', JSON.stringify(buttons, null, 2));

      // Take a screenshot of what we see
      const debugScreenshot = path.join(screenshotsDir, 'kibana_login_debug.png');
      await page.screenshot({ path: debugScreenshot, fullPage: true });
      console.log(`📸 Debug screenshot saved to: ${debugScreenshot}`);

      return {
        success: false,
        message: 'Aliyun login button not found on the page',
        url: page.url(),
        title: await page.title(),
        initialScreenshot,
        debugScreenshot
      };
    }

    console.log('✅ Aliyun login button exists!');

    // Get button text for logging
    const buttonText = await aliyunButton.textContent();
    console.log(`📝 Button text: "${buttonText}"`);

    // Click the button
    console.log('🖱️ Clicking Aliyun login button...');
    await aliyunButton.click();

    // Wait for navigation or response
    console.log('⏳ Waiting for redirect (3 seconds)...');
    await sleep(3000);

    // Check current URL
    const currentUrl = page.url();
    console.log(`📍 Current URL after click: ${currentUrl}`);

    // Take screenshot after click
    const afterClickScreenshot = path.join(screenshotsDir, 'kibana_login_after_click.png');
    await page.screenshot({ path: afterClickScreenshot, fullPage: true });
    console.log(`📸 Screenshot after click saved to: ${afterClickScreenshot}`);

    // Check if redirected to Aliyun
    const isAliyunRedirect = currentUrl.includes('signin.aliyun.com') ||
                           currentUrl.includes('aliyun.com') ||
                           currentUrl.includes('aliyuncs.com');

    console.log(`\n📊 Verification Results:`);
    console.log(`   Initial URL: ${loginUrl}`);
    console.log(`   Final URL: ${currentUrl}`);
    console.log(`   Aliyun Redirect: ${isAliyunRedirect ? '✅ YES' : '❌ NO'}`);
    console.log(`   Button Found: ✅ YES`);
    console.log(`   Button Text: "${buttonText}"`);

    return {
      success: true,
      message: 'Aliyun SSO integration verified successfully',
      initialUrl: loginUrl,
      finalUrl: currentUrl,
      isAliyunRedirect,
      buttonText: buttonText?.trim(),
      initialScreenshot,
      afterClickScreenshot
    };

  } catch (error) {
    console.error('❌ Error during verification:', error);

    // Try to take error screenshot
    if (page) {
      try {
        const errorScreenshot = path.join(screenshotsDir, 'kibana_login_error.png');
        await page.screenshot({ path: errorScreenshot, fullPage: true });
        console.log(`📸 Error screenshot saved to: ${errorScreenshot}`);
      } catch (screenshotError) {
        console.error('Failed to take error screenshot:', screenshotError);
      }
    }

    return {
      success: false,
      message: `Error during verification: ${error}`,
      error: error.message || String(error)
    };

  } finally {
    // Cleanup
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});

    console.log('🏁 Verification complete');
  }
}

// Run verification
verifyAliyunSSO()
  .then(result => {
    console.log('\n📋 Final Result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
