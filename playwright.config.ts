import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    // Software adapter for headless tests only; the app uses the user's GPU.
    launchOptions: {
      args:
        process.env.PAYSLIP_NATIVE_GPU === "1"
          ? []
          : ["--enable-unsafe-webgpu", "--use-angle=swiftshader"],
    },
  },
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
