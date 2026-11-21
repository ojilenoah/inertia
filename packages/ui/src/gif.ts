/*
 * A small animated-GIF encoder (no libraries): every frame is mapped to one fixed 256-colour
 * palette (6×7×6 colour cube + greys) with light dithering, then LZW-compressed.
 */

const PAL: number[] = [];
for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) PAL.push(Math.round((r * 255) / 5), Math.round((g * 255) / 6), Math.round((b * 255) / 5));
while (PAL.length < 256 * 3) { const v = Math.round(((PAL.length / 3 - 252) * 255) / 3); PAL.push(v, v, v); }
const nearest = (r: number, g: number, b: number) => Math.round((Math.min(255, Math.max(0, r)) * 5) / 255) * 42 + Math.round((Math.min(255, Math.max(0, g)) * 6) / 255) * 6 + Math.round((Math.min(255, Math.max(0, b)) * 5) / 255);

class Bytes {
  data: number[] = [];
  byte(b: number) { this.data.push(b & 255); }
  word(w: number) { this.byte(w); this.byte(w >> 8); }
  str(s: string) { for (const c of s) this.byte(c.charCodeAt(0)); }
}

/** Indexes for one frame (ordered dithering keeps gradients smooth). */
function quantize(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = (bayer[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 40;
    out[y * w + x] = nearest(rgba[i] + d, rgba[i + 1] + d, rgba[i + 2] + d);
  }
  return out;
}

function lzw(out: Bytes, idx: Uint8Array) {
  const minCode = 8, clear = 1 << minCode, eoi = clear + 1;
  out.byte(minCode);
  let codeSize = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  const block: number[] = [];
  let buf = 0, bits = 0;
  const emit = (code: number) => {
    buf |= code << bits; bits += codeSize;
    while (bits >= 8) { block.push(buf & 255); buf >>= 8; bits -= 8; if (block.length === 255) { out.byte(255); block.forEach((b) => out.byte(b)); block.length = 0; } }
  };
  emit(clear);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i], key = (prefix << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) { dict.set(key, next++); if (next > 1 << codeSize && codeSize < 12) codeSize++; }
    else { emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix); emit(eoi);
  if (bits > 0) block.push(buf & 255);
  for (let i = 0; i < block.length; i += 255) { const part = block.slice(i, i + 255); out.byte(part.length); part.forEach((b) => out.byte(b)); }
  out.byte(0);
}

export class GifWriter {
  private b = new Bytes();
  constructor(private w: number, private h: number) {
    const b = this.b;
    b.str("GIF89a"); b.word(w); b.word(h); b.byte(0xf7); b.byte(0); b.byte(0);
    for (const v of PAL) b.byte(v);
    b.byte(0x21); b.byte(0xff); b.byte(11); b.str("NETSCAPE2.0"); b.byte(3); b.byte(1); b.word(0); b.byte(0); // loop forever
  }
  /** Add a frame shown for `delayCs` hundredths of a second. */
  add(rgba: Uint8ClampedArray, delayCs: number) {
    const b = this.b;
    b.byte(0x21); b.byte(0xf9); b.byte(4); b.byte(0); b.word(Math.max(2, Math.round(delayCs))); b.byte(0); b.byte(0);
    b.byte(0x2c); b.word(0); b.word(0); b.word(this.w); b.word(this.h); b.byte(0);
    lzw(b, quantize(rgba, this.w, this.h));
  }
  finish(): Blob { this.b.byte(0x3b); return new Blob([new Uint8Array(this.b.data)], { type: "image/gif" }); }
}
