import type { NextConfig } from "next";

const lan = process.env.NEXT_PUBLIC_LAN_IP;

const nextConfig: NextConfig = {
  allowedDevOrigins: [lan, "127.0.0.1", "localhost"].filter(
    (value): value is string => Boolean(value),
  ),
};

export default nextConfig;
