function pushWebpackExternal(config, external) {
  if (!config.externals) {
    config.externals = [external]
    return
  }
  if (Array.isArray(config.externals)) {
    config.externals.push(external)
    return
  }
  config.externals = [config.externals, external]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["exceljs"],
  // Next 16 production builds use Turbopack by default. The webpack() hook
  // below is only for local `next dev --webpack`; an empty turbopack config
  // tells Next this split is intentional.
  turbopack: {},
  webpack: (config, { isServer, webpack, nextRuntime }) => {
    if (isServer && nextRuntime !== "edge") {
      // Instrumentation / Node compiles fail on the `node:` URI scheme and also
      // cannot resolve the rewritten bare `crypto` builtin unless it is external.
      pushWebpackExternal(config, ({ request }, callback) => {
        if (typeof request !== "string") return callback()
        if (request.startsWith("node:")) {
          return callback(null, `commonjs ${request.slice("node:".length)}`)
        }
        if (request === "crypto") {
          return callback(null, "commonjs crypto")
        }
        callback()
      })
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "")
        }),
      )
    } else if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "")
        }),
      )
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
        fs: false,
        path: false,
        os: false,
        zlib: false,
        util: false,
        http: false,
        https: false,
        net: false,
        tls: false,
        child_process: false,
        worker_threads: false,
        constants: false,
        assert: false,
        url: false,
        querystring: false,
      }
    }
    return config
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      { protocol: "https", hostname: "static.wixstatic.com", pathname: "/media/**" },
      { protocol: "https", hostname: "assets.quintevents.com", pathname: "/**" },
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
