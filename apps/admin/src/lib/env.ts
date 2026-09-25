export const env = {
  // attest edge function: local Supabase → <supabase>/functions/v1/attest, standalone → http://<host>:8000
  attestApiUrl: (process.env.NEXT_PUBLIC_ATTEST_API_URL ?? "http://127.0.0.1:54321/functions/v1/attest").replace(/\/$/, ""),
};
