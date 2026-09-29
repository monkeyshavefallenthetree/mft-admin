import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const root = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root },
};

export default nextConfig;
