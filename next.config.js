/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['@react-pdf/renderer'] },
  reactStrictMode: true,
}

module.exports = nextConfig
