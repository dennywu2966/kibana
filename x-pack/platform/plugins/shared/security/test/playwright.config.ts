/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Aliyun IAM authentication E2E tests
 */
export default defineConfig({
  testDir: './',
  testMatch: '**/*.spec.ts',
  timeout: 30000,
  fullyParallel: false, // Run tests sequentially to avoid session conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid session conflicts
  reporter: [['html'], ['list']],
  use: {
    baseURL: process.env.KIBANA_URL || 'http://localhost:5601',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before starting tests
  // webServer: {
  //   command: 'yarn start --kibana-xpack-security-aliyunenabled=true',
  //   url: 'http://localhost:5601',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120000,
  // },
});
