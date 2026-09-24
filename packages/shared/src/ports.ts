export const DEFAULT_PORTS = {
  admin: 3000,
  supabaseApi: 54321,
  supabaseDb: 54322,
  supabaseStudio: 54323,
  face: 8003,
} as const;

export function serviceUrls(host: string) {
  return {
    admin: `http://${host}:${DEFAULT_PORTS.admin}`,
    supabase: `http://${host}:${DEFAULT_PORTS.supabaseApi}`,
    face: `http://${host}:${DEFAULT_PORTS.face}`,
    attest: `http://${host}:${DEFAULT_PORTS.supabaseApi}/functions/v1/attest`,
  };
}
