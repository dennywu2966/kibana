const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--disable-web-security']
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  // Log all network requests
  page.on('request', request => {
    console.log('>> REQUEST:', request.method(), request.url());
  });

  page.on('response', async response => {
    const url = response.url();
    const status = response.status();
    console.log('<< RESPONSE:', status, url);

    // Log OAuth-related responses in detail
    if (url.includes('aliyun') || url.includes('oauth') || url.includes('callback')) {
      try {
        const contentType = response.headers()['content-type'] || '';
        console.log('  Content-Type:', contentType);

        if (contentType.includes('application/json')) {
          const body = await response.json();
          console.log('  Body:', JSON.stringify(body, null, 2));
        } else if (contentType.includes('text') || contentType.includes('html')) {
          const text = await response.text();
          console.log('  Text (first 500 chars):', text.substring(0, 500));
        }

        console.log('  Headers:', JSON.stringify(response.headers(), null, 2));
      } catch (e) {
        console.log('  Error reading response:', e.message);
      }
    }
  });

  // Log console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text());
    }
  });

  // Log page errors
  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.message);
  });

  try {
    console.log('\n=== Step 1: Get OAuth Authorization URL ===');
    const authorizeResponse = await page.goto('http://127.0.0.1:5603/kibana/api/security/aliyun/oauth/authorize?redirect_to=%2Fapp%2Fhome');
    console.log('Authorize page status:', authorizeResponse.status());

    // Get the authorization URL from the response
    const authUrlData = await authorizeResponse.json();
    const authUrl = authUrlData.authorizationUrl;
    const state = authUrlData.state;
    console.log('Authorization URL:', authUrl);
    console.log('State:', state);

    console.log('\n=== Step 2: Navigate to Aliyun Authorization Page ===');
    const aliyunPage = await context.newPage();
    await aliyunPage.goto(authUrl);

    // Wait for user to complete login
    console.log('\n=== Waiting for user to complete Aliyun login... ===');
    console.log('Please complete the login in the browser window that opened');
    console.log('Waiting for redirect back to Kibana...');

    // Set a timeout to wait for redirect
    const redirectPromise = aliyunPage.waitForURL(
      url => url.includes('47.236.247.55:5601') && url.includes('callback'),
      { timeout: 120000 }
    );

    await redirectPromise.then(() => {
      console.log('Redirected to Kibana callback!');
      console.log('Final URL:', aliyunPage.url());
    }).catch(err => {
      console.log('Timeout or error waiting for redirect:', err.message);
      console.log('Current URL:', aliyunPage.url());
    });

    // Wait a bit more to see any redirects
    await aliyunPage.waitForTimeout(5000);

    // Take screenshot
    await aliyunPage.screenshot({ path: '/tmp/oauth_final_state.png', fullPage: true });
    console.log('Screenshot saved to /tmp/oauth_final_state.png');

    console.log('\n=== Checking final state ===');
    const finalUrl = aliyunPage.url();
    console.log('Final URL:', finalUrl);

    // Check if we're on the home page or login page
    if (finalUrl.includes('/app/home')) {
      console.log('SUCCESS: Redirected to home page!');
    } else if (finalUrl.includes('/login')) {
      console.log('FAILED: Redirected back to login page');
    } else if (finalUrl.includes('callback')) {
      console.log('WARNING: Still on callback page');
    }

    // Get page content
    const bodyText = await aliyunPage.evaluate(() => document.body.innerText);
    console.log('Page content (first 1000 chars):', bodyText.substring(0, 1000));

  } catch (error) {
    console.error('ERROR:', error.message);
    console.error(error.stack);
  } finally {
    console.log('\nPress Ctrl+C to close browser...');
    // Keep browser open for inspection
    // await browser.close();
  }
})();
