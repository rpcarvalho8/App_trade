import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.72"],
  // Mantém módulos nativos do Node fora do bundle (evita "Can't resolve" em runtimes não-Node)
  serverExternalPackages: ["node-cron"],
};

export default nextConfig;
