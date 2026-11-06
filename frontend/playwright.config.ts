import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  // Reference screenshots (A12) live next to the specs, without a platform suffix: SwiftShader is
  // a software rasteriser, so the same file is used on every OS.
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Headless Chromium has no GPU. These flags let the WebGL2 fallback of
        // WebGPURenderer run on SwiftShader. Whether WebGPU itself is used headless is [verify].
        launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
      },
    },
  ],
  webServer: {
    // Every e2e test runs on the SYNTHETIC fixtures (no backend needed); see fixtures/README.md.
    command: `npm run dev:fixtures -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
