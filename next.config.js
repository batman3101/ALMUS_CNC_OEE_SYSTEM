/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Allow production builds to complete even if there are ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Allow production builds to complete even if there are TypeScript errors
    ignoreBuildErrors: true,
  },
  // React compiler and optimizations
  compiler: {
    // Suppress specific warnings
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error']
    } : false,
  },
  // Disable static optimization for better development experience
  experimental: {
    // Improve hot reload performance
    optimizeCss: false,
    // Better error handling in development
    workerThreads: false,
    cpus: 1,
  },
  // Webpack configuration
  webpack: (config, { dev, isServer }) => {
    // Better cache configuration
    if (dev) {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      };
    }
    
    // Fix for hot reload issues
    if (dev && !isServer) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: ['**/node_modules', '**/.next'],
      };
    }
    
    // Resolve alias for better imports
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': require('path').resolve(__dirname, 'src'),
    };
    
    return config;
  },
  // Disable prefetching in development
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right',
  },
  // Improve page transitions
  reactStrictMode: false,
  swcMinify: true,
};

module.exports = nextConfig;