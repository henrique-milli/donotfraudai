/** Minimal DER reader: enough to walk the Android KeyDescription attestation extension. */
export interface Tlv { cls: number; constructed: boolean; tag: number; value: Uint8Array }

export function parse(buf: Uint8Array, i = 0): [Tlv, number] {
  const b = buf[i++];
  const cls = b >> 6, constructed = (b & 0x20) !== 0;
  let tag = b & 0x1f;
  if (tag === 0x1f) { // high tag number form (KeyDescription uses tags up to 7xx)
    tag = 0;
    for (;;) { const c = buf[i++]; tag = (tag << 7) | (c & 0x7f); if (!(c & 0x80)) break; }
  }
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f; len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | buf[i++];
  }
  return [{ cls, constructed, tag, value: buf.subarray(i, i + len) }, i + len];
}

export function children(t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < t.value.length) { const [c, j] = parse(t.value, i); out.push(c); i = j; }
  return out;
}

export function int(t: Tlv): number {
  let v = 0;
  for (const b of t.value) v = v * 256 + b;
  if (t.value.length && t.value[0] & 0x80) v -= 2 ** (8 * t.value.length);
  return v;
}
