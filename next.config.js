/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.loopnet.com' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || []
      config.externals.push('puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth')
    }
    return config
  },
}

module.exports = nextConfig
