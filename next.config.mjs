/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["mupdf", "pg"] },
};
export default nextConfig;
