export const DEFAULT_PORTS = {
  admin: 3000,
  metro: 8081,
  supabaseApi: 54321,
  supabaseDb: 54322,
  supabaseStudio: 54323,
  vision: 8001,
  risk: 8002,
} as const;

export function serviceUrls(host: string) {
  return {
    admin: `http://${host}:${DEFAULT_PORTS.admin}`,
    metro: `http://${host}:${DEFAULT_PORTS.metro}`,
    supabase: `http://${host}:${DEFAULT_PORTS.supabaseApi}`,
    vision: `http://${host}:${DEFAULT_PORTS.vision}`,
    risk: `http://${host}:${DEFAULT_PORTS.risk}`,
  };
}
