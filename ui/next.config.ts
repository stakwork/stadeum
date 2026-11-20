import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The connect seam's confirm page is never framed: a framed copy would
  // invite a click the person didn't mean (lib/connect.ts).
  async headers() {
    return [
      {
        source: "/connect/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
