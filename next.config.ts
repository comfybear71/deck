import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid auto-generating AGENTS.md / CLAUDE.md on every dev start.
  agentRules: false,
  // `@ffmpeg-installer/ffmpeg` (server-side last-frame extraction,
  // `lib/serverVideoFrame.ts`) resolves its platform binary's path with
  // runtime string concatenation, not a statically analyzable
  // `require(...)` — Next's build-time file tracer can't discover it on
  // its own, so it has to be force-included or the deployed function is
  // missing the binary and only fails in production. See
  // `lib/serverVideoFrame.ts`'s module doc comment.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@ffmpeg-installer/**/*"],
  },
};

export default nextConfig;
