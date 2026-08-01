/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // OT-080: instrumentation.ts runs the test-mode boot gate before any request.
    instrumentationHook: true,
  },
};

export default nextConfig;
