import type { NextConfig } from "next";
const config: NextConfig = {
  output: process.env.NF_STATIC_EXPORT === "1" ? "export" : "standalone",
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  ...(process.env.NF_STATIC_EXPORT === "1"
    ? {}
    : {
        async rewrites() {
          const routes = [
            {
              source: "/api/:path*",
              destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/api/:path*`,
            },
          ];
          const helper = process.env.FIREBASE_AUTH_HELPER_ORIGIN;
          if (helper) {
            const u = new URL(helper);
            if (
              u.protocol !== "https:" ||
              !u.hostname.endsWith(".firebaseapp.com") ||
              u.pathname !== "/"
            )
              throw Error("Use the official Firebase auth helper origin");
            routes.push({
              source: "/__/auth/:path*",
              destination: `${u.origin}/__/auth/:path*`,
            });
          }
          return routes;
        },
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "same-origin" },
                { key: "X-Frame-Options", value: "DENY" },
              ],
            },
          ];
        },
      }),
};
export default config;
