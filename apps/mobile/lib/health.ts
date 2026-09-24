export type PingResult = {
  name: string;
  url: string;
  ok: boolean;
  detail: string;
};

export async function ping(name: string, url: string): Promise<PingResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return {
      name,
      url,
      ok: res.ok || res.status === 401,
      detail: `${res.status} ${res.statusText}`.trim(),
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
