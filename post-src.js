/* bitcoinallchat — builds the unsigned transaction that carries a message.
   No private key, seed or signature is handled here. This file turns text into
   an unsigned PSBT with one OP_RETURN output and change back to the same
   address; a wallet or an offline signer does the signing. The only value that
   leaves the wallet is the miner fee. */
import qrcode from 'qrcode-generator';

const MAXDATA = 100000;          // Bitcoin Core v30 default -datacarriersize
const LEGACY_SAFE = 83;          // what pre-v30 nodes and Knots still enforce
const PUSH_MAX = 520;

const hexToBytes = h => { const a = new Uint8Array(h.length >> 1); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a };
const bytesToHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const utf8 = s => new TextEncoder().encode(s);
const sha256 = async b => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const dsha = async b => sha256(await sha256(b));

/* ------------------------------------------------ byte writer */
class W {
  constructor() { this.a = [] }
  u8(n) { this.a.push(n & 0xff); return this }
  u16(n) { this.a.push(n & 0xff, (n >> 8) & 0xff); return this }
  u32(n) { for (let i = 0; i < 4; i++) this.a.push((n >>> (8 * i)) & 0xff); return this }
  u64(n) { let v = BigInt(n); for (let i = 0; i < 8; i++) { this.a.push(Number(v & 0xffn)); v >>= 8n } return this }
  vi(n) {
    if (n < 0xfd) return this.u8(n);
    if (n <= 0xffff) return this.u8(0xfd).u16(n);
    if (n <= 0xffffffff) return this.u8(0xfe).u32(n);
    return this.u8(0xff).u64(n);
  }
  b(x) { for (const v of x) this.a.push(v); return this }
  vb(x) { return this.vi(x.length).b(x) }
  out() { return new Uint8Array(this.a) }
}

/* ------------------------------------------------ addresses */
const CS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const polymod = v => {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let c = 1;
  for (const d of v) { const t = c >>> 25; c = ((c & 0x1ffffff) << 5) ^ d; for (let i = 0; i < 5; i++) if ((t >>> i) & 1) c ^= G[i] }
  return c >>> 0;
};
const hrpExpand = h => { const o = []; for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) >> 5); o.push(0); for (let i = 0; i < h.length; i++) o.push(h.charCodeAt(i) & 31); return o };
function convertbits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = [], max = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from) throw new Error('bad address');
    acc = (acc << from) | v; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & max) }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & max) }
  else if (bits >= from || ((acc << (to - bits)) & max)) throw new Error('bad address');
  return out;
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  const bytes = [0];
  for (const c of s) {
    let carry = B58.indexOf(c);
    if (carry < 0) throw new Error('not a Bitcoin address');
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8 }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/* address -> { type, script } */
export async function decodeAddress(a) {
  a = a.trim();
  if (/^(bc1|BC1)/.test(a)) {
    const low = a.toLowerCase();
    if (a !== low && a !== a.toUpperCase()) throw new Error('that address mixes upper and lower case');
    const pos = low.lastIndexOf('1');
    const hrp = low.slice(0, pos), data = [];
    for (const c of low.slice(pos + 1)) { const v = CS.indexOf(c); if (v < 0) throw new Error('not a Bitcoin address'); data.push(v) }
    if (hrp !== 'bc') throw new Error('that address is not on mainnet');
    const chk = polymod(hrpExpand(hrp).concat(data));
    const ver = data[0], prog = new Uint8Array(convertbits(data.slice(1, -6), 5, 8, false));
    if (ver === 0 && chk !== 1) throw new Error('bad address checksum');
    if (ver !== 0 && chk !== 0x2bc830a3) throw new Error('bad address checksum');
    if (ver === 0 && prog.length !== 20 && prog.length !== 32) throw new Error('unsupported address');
    const script = new W().u8(ver === 0 ? 0 : 0x50 + ver).vb(prog).out();
    return { type: ver === 1 && prog.length === 32 ? 'p2tr' : ver === 0 && prog.length === 20 ? 'p2wpkh' : 'p2wsh', script };
  }
  const d = b58decode(a);
  if (d.length !== 25) throw new Error('not a Bitcoin address');
  const body = d.subarray(0, 21), sum = await dsha(body);
  for (let i = 0; i < 4; i++) if (sum[i] !== d[21 + i]) throw new Error('bad address checksum');
  const h = d.subarray(1, 21);
  if (d[0] === 0x00) return { type: 'p2pkh', script: new W().u8(0x76).u8(0xa9).vb(h).u8(0x88).u8(0xac).out() };
  if (d[0] === 0x05) throw new Error('nested SegWit addresses (starting with 3) are not supported here — switch your wallet to a native SegWit (bc1q) or Taproot (bc1p) address');
  throw new Error('unsupported address');
}

/* ------------------------------------------------ OP_RETURN */
export function dataScript(bytes) {
  if (bytes.length > MAXDATA) throw new Error('message is larger than the ' + MAXDATA.toLocaleString() + ' byte relay limit');
  const w = new W().u8(0x6a);
  for (let o = 0; o < bytes.length; o += PUSH_MAX) {
    const c = bytes.subarray(o, Math.min(o + PUSH_MAX, bytes.length));
    if (c.length < 0x4c) w.u8(c.length);
    else if (c.length <= 0xff) w.u8(0x4c).u8(c.length);
    else w.u8(0x4d).u16(c.length);
    w.b(c);
  }
  return w.out();
}

/* ------------------------------------------------ size and coin selection */
const INWIT = { p2wpkh: 108, p2tr: 65, p2wsh: 108, p2pkh: 0 };
const INBASE = { p2wpkh: 41, p2tr: 41, p2wsh: 41, p2pkh: 148 };
const OUTLEN = { p2wpkh: 31, p2tr: 43, p2wsh: 43, p2pkh: 34 };
export const DUST = { p2wpkh: 294, p2tr: 330, p2wsh: 330, p2pkh: 546 };
const vi = n => n < 0xfd ? 1 : n <= 0xffff ? 3 : 5;

export function vsize(nIn, type, dataLen, withChange) {
  const outs = (8 + vi(dataLen) + dataLen) + (withChange ? OUTLEN[type] : 0);
  const base = 4 + vi(nIn) + nIn * INBASE[type] + vi(withChange ? 2 : 1) + outs + 4;
  const wit = INWIT[type] ? 2 + nIn * INWIT[type] : 0;
  return base + Math.ceil(wit / 4);
}

export function select(utxos, feeRate, dataLen, type) {
  const pool = [...utxos].sort((a, b) => b.value - a.value);
  const picked = []; let sum = 0, sweep = null;
  for (const u of pool) {
    picked.push(u); sum += u.value;
    const withChange = Math.ceil(vsize(picked.length, type, dataLen, true) * feeRate);
    const noChange = Math.ceil(vsize(picked.length, type, dataLen, false) * feeRate);
    if (sum >= withChange + DUST[type]) return { inputs: [...picked], fee: withChange, change: sum - withChange, overpay: 0 };
    if (!sweep && sum >= noChange) sweep = { inputs: [...picked], fee: sum, change: 0, overpay: sum - noChange };
  }
  if (sweep) return sweep;
  const need = Math.ceil(vsize(Math.max(pool.length, 1), type, dataLen, false) * feeRate);
  throw new Error(`this message costs about ${need.toLocaleString()} sats to publish at ${feeRate} sat/vB, and the address holds ${sum.toLocaleString()}`);
}

/* ------------------------------------------------ PSBT */
function unsignedTx(inputs, outputs) {
  const w = new W().u32(2).vi(inputs.length);
  for (const i of inputs) w.b(hexToBytes(i.txid).reverse()).u32(i.vout).vi(0).u32(0xfffffffd);
  w.vi(outputs.length);
  for (const o of outputs) w.u64(o.value).vb(o.script);
  return w.u32(0).out();
}

export async function buildPsbt({ address, publicKey, utxos, message, feeRate, prevTx = {} }) {
  const data = typeof message === 'string' ? utf8(message) : message;
  const ds = dataScript(data);
  const { type, script } = await decodeAddress(address);
  if (type === 'p2wsh') throw new Error('that address type cannot be spent from here');
  const { inputs, fee, change, overpay } = select(utxos, feeRate, ds.length, type);

  const outs = [{ value: 0, script: ds }];
  if (change > 0) outs.push({ value: change, script });
  const tx = unsignedTx(inputs, outs);

  const w = new W().b([0x70, 0x73, 0x62, 0x74, 0xff]);
  w.vi(1).u8(0x00).vb(tx);                    // global unsigned tx
  w.u8(0x00);                                  // end of globals
  for (const u of inputs) {
    if (type === 'p2pkh') {
      const hex = prevTx[u.txid];
      if (!hex) throw new Error('legacy inputs need the funding transaction; none was supplied');
      w.vi(1).u8(0x00).vb(hexToBytes(hex));    // non-witness utxo
    } else {
      const v = new W().u64(u.value).vb(script).out();
      w.vi(1).u8(0x01).vb(v);                  // witness utxo
    }
    if (type === 'p2tr' && publicKey) {
      const pk = hexToBytes(publicKey);
      w.vi(1).u8(0x17).vb(pk.length === 33 ? pk.subarray(1) : pk);   // tap internal key
    }
    w.u8(0x00);
  }
  for (let i = 0; i < outs.length; i++) w.u8(0x00);

  return { psbt: w.out(), fee, change, overpay, vbytes: vsize(inputs.length, type, ds.length, change > 0), inputs, dataLen: ds.length, type };
}

/* ------------------------------------------------ extract a finalized PSBT */
function reader(b) {
  let p = 0;
  const u8 = () => b[p++];
  const vi = () => { const n = b[p++]; if (n < 0xfd) return n;
    if (n === 0xfd) { const v = b[p] | (b[p + 1] << 8); p += 2; return v }
    if (n === 0xfe) { const v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24); p += 4; return v >>> 0 }
    let v = 0n; for (let i = 0; i < 8; i++) v |= BigInt(b[p + i]) << BigInt(8 * i); p += 8; return Number(v) };
  const take = n => { const s = b.subarray(p, p + n); p += n; return s };
  return { u8, vi, take, at: () => p, done: () => p >= b.length };
}
export function extract(psbt) {
  const r = reader(psbt);
  const magic = r.take(5);
  if (bytesToHex(magic) !== '70736274ff') throw new Error('that is not a PSBT');
  let tx = null;
  for (;;) { const kl = r.vi(); if (!kl) break; const k = r.take(kl); const v = r.take(r.vi()); if (k[0] === 0x00) tx = v }
  if (!tx) throw new Error('the PSBT carries no transaction');
  const t = reader(tx);
  const ver = t.take(4), nin = t.vi(), ins = [];
  for (let i = 0; i < nin; i++) { const op = t.take(36); t.take(t.vi()); const seq = t.take(4); ins.push({ op, seq }) }
  const nout = t.vi(), outs = [];
  for (let i = 0; i < nout; i++) { const val = t.take(8); const s = t.take(t.vi()); outs.push({ val, s }) }
  const lock = t.take(4);

  const sigs = [];
  for (let i = 0; i < nin; i++) {
    const m = { ss: null, wit: null };
    for (;;) { const kl = r.vi(); if (!kl) break; const k = r.take(kl); const v = r.take(r.vi());
      if (k[0] === 0x07) m.ss = v; if (k[0] === 0x08) m.wit = v }
    sigs.push(m);
  }
  if (sigs.every(s => !s.ss && !s.wit)) throw new Error('that PSBT is not signed yet');
  const segwit = sigs.some(s => s.wit && s.wit.length);
  const w = new W().b(ver);
  if (segwit) w.u8(0x00).u8(0x01);
  w.vi(nin);
  for (let i = 0; i < nin; i++) w.b(ins[i].op).vb(sigs[i].ss || new Uint8Array(0)).b(ins[i].seq);
  w.vi(nout);
  for (const o of outs) w.b(o.val).vb(o.s);
  if (segwit) for (let i = 0; i < nin; i++) { const x = sigs[i].wit; if (x && x.length) w.b(x); else w.u8(0x00) }
  w.b(lock);
  return bytesToHex(w.out());
}

/* ------------------------------------------------ BBQr (bbqr.org) */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(b) {
  let s = '', bits = 0, acc = 0;
  for (const v of b) { acc = (acc << 8) | v; bits += 8; while (bits >= 5) { bits -= 5; s += B32[(acc >> bits) & 31] } }
  if (bits) s += B32[(acc << (5 - bits)) & 31];
  return s;
}
const b36 = n => n.toString(36).toUpperCase().padStart(2, '0');
/* Splits a payload into BBQr frames. Encoding "2" is plain base32, which every
   BBQr reader understands and keeps this file free of a compression library. */
export function bbqr(bytes, fileType = 'P', perFrame = 600) {
  const chunkBytes = Math.floor(perFrame / 8) * 5;              // base32 works in 5-byte groups
  const n = Math.max(1, Math.ceil(bytes.length / chunkBytes));
  const size = Math.ceil(bytes.length / n / 5) * 5;
  const parts = [];
  for (let i = 0; i < n; i++)
    parts.push('B$2' + fileType + b36(n) + b36(i) + base32(bytes.subarray(i * size, Math.min((i + 1) * size, bytes.length))));
  return parts;
}
export function bbqrJoin(parts) {
  const seen = new Map();
  let total = 0, ft = 'P';
  for (const p of parts) {
    if (!/^B\$/.test(p)) throw new Error('that is not a BBQr frame');
    ft = p[3];
    total = parseInt(p.slice(4, 6), 36);
    seen.set(parseInt(p.slice(6, 8), 36), p.slice(8));
  }
  if (seen.size < total) throw new Error(`only ${seen.size} of ${total} frames scanned`);
  const out = [];
  for (let i = 0; i < total; i++) {
    const s = seen.get(i);
    if (s == null) throw new Error('frame ' + i + ' is missing');
    let bits = 0, acc = 0;
    for (const c of s) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad frame data');
      acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff) } }
  }
  return { fileType: ft, raw: new Uint8Array(out) };
}

export const b64enc = b => { let s = ''; for (const v of b) s += String.fromCharCode(v); return btoa(s) };
export const b64dec = s => { const t = atob(s); const a = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) a[i] = t.charCodeAt(i); return a };

export function qrCanvas(text, px = 300) {
  const q = qrcode(0, 'L');
  q.addData(text, 'Alphanumeric');
  q.make();
  const n = q.getModuleCount(), quiet = 4, scale = Math.max(1, Math.floor(px / (n + quiet * 2)));
  const side = (n + quiet * 2) * scale;
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, side, side);
  g.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (q.isDark(y, x)) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
  c.style.width = '100%'; c.style.imageRendering = 'pixelated';
  return c;
}

export const API_LIMITS = { MAXDATA, LEGACY_SAFE };
export { hexToBytes, bytesToHex, utf8 };
