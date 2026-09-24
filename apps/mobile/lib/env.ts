export const env = {
  lanIp: process.env.EXPO_PUBLIC_LAN_IP ?? "127.0.0.1",
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  visionUrl: process.env.EXPO_PUBLIC_VISION_URL ?? "http://127.0.0.1:8001",
  riskUrl: process.env.EXPO_PUBLIC_RISK_URL ?? "http://127.0.0.1:8002",
  adminUrl: process.env.EXPO_PUBLIC_ADMIN_URL ?? "http://127.0.0.1:3000",
};
