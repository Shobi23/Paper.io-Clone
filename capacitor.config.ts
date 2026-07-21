import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.papertrail.arcade",
  appName: "Paper Trail",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#f4f1e8",
    webContentsDebuggingEnabled: false,
  },
};

export default config;