import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid auto-generating AGENTS.md / CLAUDE.md on every dev start.
  agentRules: false,
};

export default nextConfig;
