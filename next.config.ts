import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from appending its own agent-rules block to our AGENTS.md.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
