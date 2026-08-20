/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_UPSTREAM}/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;