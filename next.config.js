/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 빌드 시 ESLint 검사 수행 (에러가 있으면 빌드 실패)
    ignoreDuringBuilds: false,
  },
  typescript: {
    // 빌드 시 타입 검사 수행 (에러가 있으면 빌드 실패).
    // 이 스위치가 켜져 있던 동안 존재하지 않는 컬럼을 읽는 버그
    // (good_qty, machines.default_tact_time 등)가 프로덕션까지 도달했다.
    ignoreBuildErrors: false,
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