/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingRoot: import.meta.dirname,
  serverExternalPackages: ["@aicoo/sharedos"],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "content-type,authorization,x-agent-id" },
        ],
      },
    ];
  },
};
