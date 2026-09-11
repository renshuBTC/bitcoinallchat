/* bitcoinallchat — builds the unsigned transaction that carries a message.
   No private key or seed is handled here, and this module does not sign. It turns text into
   an unsigned PSBT with one OP_RETURN output and change back to the same
   address and extracts finalized transactions; a wallet or offline signer signs. The only value that
   leaves the wallet is the miner fee. */
import qrcode from 'qrcode-generator';

const MAXDATA = 100000;          // Bitcoin Core v30 default -datacarriersize
const LEGACY_SAFE = 83;          // what pre-v30 nodes and Knots still enforce
const PUSH_MAX = 520;

const hexToBytes = h => {
  if (typeof h !== 'string' || h.length > 4000000 || h.length % 2 || !/^[0-9a-f]*$/i.test(h)) throw new Error('invalid hex encoding');
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return a;
};
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
  if (typeof a !== 'string' || !a.trim() || a.trim().length > 90) throw new Error('not a Bitcoin address');
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
    if (ver > 16 || data.length < 7 || prog.length < 2 || prog.length > 40 || (ver === 0 && prog.length !== 20 && prog.length !== 32)) throw new Error('unsupported address');
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
  if (!(bytes instanceof Uint8Array)) throw new Error('message must be text or bytes');
  if (bytes.length > MAXDATA) throw new Error('message is larger than the ' + MAXDATA.toLocaleString() + ' byte relay limit');
  const w = new W().u8(0x6a);
  for (let o = 0; o < bytes.length; o += PUSH_MAX) {
    const c = bytes.subarray(o, Math.min(o + PUSH_MAX, bytes.length));
    if (c.length < 0x4c) w.u8(c.length);
    else if (c.length <= 0xff) w.u8(0x4c).u8(c.length);
    else w.u8(0x4d).u16(c.length);
    w.b(c);
  }
  const script = w.out();
  if (script.length > MAXDATA) throw new Error('message and script overhead exceed the relay limit');
  return script;
}

/* ------------------------------------------------ size and coin selection */
// Taproot allows a 65-byte SIGHASH_ALL signature, plus stack count and item length.
const INWIT = { p2wpkh: 108, p2tr: 67, p2wsh: 108, p2pkh: 0 };
const INBASE = { p2wpkh: 41, p2tr: 41, p2wsh: 41, p2pkh: 148 };
const OUTLEN = { p2wpkh: 31, p2tr: 43, p2wsh: 43, p2pkh: 34 };
export const DUST = { p2wpkh: 294, p2tr: 330, p2wsh: 330, p2pkh: 546 };
const vi = n => n < 0xfd ? 1 : n <= 0xffff ? 3 : 5;

export function vsize(nIn, type, dataLen, withChange) {
  if (!Object.hasOwn(INBASE, type) || !Number.isInteger(nIn) || nIn < 1 || nIn > 10000 || !Number.isInteger(dataLen) || dataLen < 1 || dataLen > MAXDATA) throw new Error('invalid transaction size');
  const outs = (8 + vi(dataLen) + dataLen) + (withChange ? OUTLEN[type] : 0);
  const base = 4 + vi(nIn) + nIn * INBASE[type] + vi(withChange ? 2 : 1) + outs + 4;
  const wit = INWIT[type] ? 2 + nIn * INWIT[type] : 0;
  return base + Math.ceil(wit / 4);
}

function coinsSnapshot(utxos) {
  if (!Array.isArray(utxos) || utxos.length > 10000) throw new Error('invalid unspent outputs');
  const seen = new Set(); let total = 0;
  return utxos.map(u => {
    if (!u || typeof u.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(u.txid) || !Number.isInteger(u.vout) || u.vout < 0 || u.vout > 0xffffffff || !Number.isSafeInteger(u.value) || u.value < 0 || u.value > 2100000000000000) throw new Error('invalid unspent output');
    const txid = u.txid.toLowerCase(), key = txid + ':' + u.vout;
    if (seen.has(key)) throw new Error('duplicate unspent output');
    seen.add(key); total += u.value;
    if (!Number.isSafeInteger(total) || total > 2100000000000000) throw new Error('unspent amount is out of range');
    return {txid, vout: u.vout, value: u.value};
  });
}
export function select(utxos, feeRate, dataLen, type) {
  if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('invalid fee rate');
  vsize(1, type, dataLen, false);
  const pool = coinsSnapshot(utxos).sort((a, b) => b.value - a.value);
  const picked = []; let sum = 0, sweep = null;
  for (const u of pool) {
    picked.push(u); sum += u.value;
    const sizeWithChange = vsize(picked.length, type, dataLen, true), sizeNoChange = vsize(picked.length, type, dataLen, false);
    if (sizeNoChange > MAXDATA) { if (sweep) return sweep; throw new Error('message and transaction overhead exceed the relay size limit') }
    const withChange = Math.ceil(sizeWithChange * feeRate), noChange = Math.ceil(sizeNoChange * feeRate);
    if (!Number.isSafeInteger(withChange) || !Number.isSafeInteger(noChange)) throw new Error('transaction fee is out of range');
    if (sum >= withChange + DUST[type] && sizeWithChange > MAXDATA) throw new Error('message and transaction overhead exceed the relay size limit');
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
  const data = typeof message === 'string' ? utf8(message) : message instanceof Uint8Array ? new Uint8Array(message) : null;
  utxos = coinsSnapshot(utxos); prevTx = {...prevTx};
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
      if (pk.length !== 32 && !(pk.length === 33 && (pk[0] === 2 || pk[0] === 3))) throw new Error('invalid Taproot public key');
      w.vi(1).u8(0x17).vb(pk.length === 33 ? pk.subarray(1) : pk);   // tap internal key
    }
    w.u8(0x00);
  }
  for (let i = 0; i < outs.length; i++) w.u8(0x00);

  return { psbt: w.out(), fee, change, overpay, vbytes: vsize(inputs.length, type, ds.length, change > 0), inputs, dataLen: ds.length, type };
}

/* ------------------------------------------------ extract a finalized PSBT */
function reader(b) {
  if (!(b instanceof Uint8Array) || b.length > 2000000) throw new Error('invalid PSBT data');
  let p = 0;
  const take = n => {
    if (!Number.isSafeInteger(n) || n < 0 || n > b.length - p) throw new Error('truncated PSBT data');
    const s = b.subarray(p, p + n); p += n; return s;
  };
  const u8 = () => take(1)[0];
  const vi = () => {
    const n = u8(); if (n < 0xfd) return n;
    const a = take(n === 0xfd ? 2 : n === 0xfe ? 4 : 8); let value = 0n;
    for (let i = 0; i < a.length; i++) value |= BigInt(a[i]) << BigInt(i * 8);
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(n === 0xfd ? 253 : n === 0xfe ? 65536 : 4294967296)) throw new Error('invalid PSBT length');
    return Number(value);
  };
  return { u8, vi, take, at: () => p, done: () => p === b.length, remaining: () => b.length - p };
}
export function extract(psbt) {
  const r = reader(psbt);
  const magic = r.take(5);
  if (bytesToHex(magic) !== '70736274ff') throw new Error('that is not a PSBT');
  const map = () => {
    const fields = [], seen = new Set();
    for (;;) {
      const kl = r.vi(); if (!kl) return fields;
      const key = r.take(kl), id = bytesToHex(key);
      if (seen.has(id)) throw new Error('duplicate PSBT field');
      seen.add(id); fields.push([key, r.take(r.vi())]);
    }
  };
  const singleton = (fields, type) => {
    const matches = fields.filter(([key]) => key[0] === type);
    if (matches.length > 1 || matches.some(([key]) => key.length !== 1)) throw new Error('invalid PSBT field');
    return matches[0]?.[1];
  };
  const tx = singleton(map(), 0);
  if (!tx) throw new Error('the PSBT carries no transaction');
  const t = reader(tx);
  const ver = t.take(4), nin = t.vi(), ins = [];
  if (!nin || nin > Math.floor(t.remaining() / 41)) throw new Error('invalid unsigned transaction inputs');
  for (let i = 0; i < nin; i++) {
    const op = t.take(36); if (t.vi() !== 0) throw new Error('PSBT transaction must be unsigned');
    const seq = t.take(4); ins.push({ op, seq });
  }
  const nout = t.vi(), outs = [];
  if (!nout || nout > Math.floor(t.remaining() / 9)) throw new Error('invalid unsigned transaction outputs');
  for (let i = 0; i < nout; i++) { const val = t.take(8); const s = t.take(t.vi()); outs.push({ val, s }) }
  const lock = t.take(4);
  if (!t.done()) throw new Error('unexpected unsigned transaction data');

  const sigs = [];
  for (let i = 0; i < nin; i++) {
    const fields = map(), m = { ss: singleton(fields, 7), wit: singleton(fields, 8) };
    let count = 0;
    if (m.wit) {
      const witness = reader(m.wit); count = witness.vi();
      if (count > witness.remaining()) throw new Error('invalid final witness');
      for (let j = 0; j < count; j++) witness.take(witness.vi());
      if (!witness.done()) throw new Error('unexpected final witness data');
      if (!count) m.wit = null;
    }
    if (!m.ss?.length && !count) throw new Error('every PSBT input must be finalized before extraction');
    sigs.push(m);
  }
  for (let i = 0; i < nout; i++) map();
  if (!r.done()) throw new Error('unexpected data after PSBT');
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
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 2000000 || !/^[PTJCBUX]$/.test(fileType) || !Number.isInteger(perFrame) || perFrame < 8 || perFrame > 4288) throw new Error('invalid BBQr payload or frame size');
  const chunkBytes = Math.floor(perFrame / 8) * 5;              // base32 works in 5-byte groups
  const n = Math.max(1, Math.ceil(bytes.length / chunkBytes));
  if (n > 1295) throw new Error('too many BBQr frames');
  const size = Math.ceil(bytes.length / n / 5) * 5;
  const parts = [];
  for (let i = 0; i < n; i++)
    parts.push('B$2' + fileType + b36(n) + b36(i) + base32(bytes.subarray(i * size, Math.min((i + 1) * size, bytes.length))));
  return parts;
}
async function inflateBBQr(input, signal) {
  if (typeof DecompressionStream !== 'function' || typeof ReadableStream !== 'function') throw new Error('This browser cannot open compressed BBQr; paste the signed PSBT or transaction instead');
  if (signal?.aborted) throw new Error('Offline decoding cancelled');
  let offset = 0, decoder;
  try { decoder = new DecompressionStream('deflate-raw') }
  catch { throw new Error('This browser cannot open compressed BBQr; paste the signed PSBT or transaction instead') }
  // Small input chunks also bound the amount a single compressed chunk can expand into.
  const stream = new ReadableStream({pull(controller) {
    if (offset === input.length) { controller.close(); return }
    const end = Math.min(offset + 1024, input.length); controller.enqueue(input.subarray(offset, end)); offset = end;
  }}).pipeThrough(decoder);
  const reader = stream.getReader(), chunks = []; let length = 0, timer, abort, stoppedError;
  const stopped = new Promise((_, reject) => {
    const stop = error => { stoppedError = error; reader.cancel(error).catch(() => {}); reject(error) };
    abort = () => stop(new Error('Offline decoding cancelled'));
    timer = setTimeout(() => stop(new Error('Compressed BBQr decoding took too long')), 5000);
    signal?.addEventListener('abort', abort, {once:true});
  });
  try {
    for (;;) {
      const {value, done} = await Promise.race([reader.read(), stopped]);
      if (stoppedError) throw stoppedError;
      if (done) break;
      length += value.length;
      if (length > 2000000) throw new Error('Decoded BBQr payload is too large');
      chunks.push(value);
    }
    if (!length) throw new Error('Compressed BBQr contains no data');
    const output = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { output.set(chunk, at); at += chunk.length }
    return output;
  } catch (error) {
    reader.cancel(error).catch(() => {});
    throw stoppedError || new Error('Could not decode compressed BBQr: ' + (error?.message || String(error)));
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); reader.releaseLock();
  }
}
export async function bbqrJoin(parts, {signal} = {}) {
  if (signal?.aborted) throw new Error('Offline decoding cancelled');
  if (!Array.isArray(parts) || !parts.length || parts.length > 10000) throw new Error('invalid BBQr frames');
  const seen = new Map();
  let total = 0, ft = '', encoding = '', length = 0;
  for (const p of parts) {
    if (typeof p !== 'string' || !/^B\$[2HZ][PTJCBUX][0-9A-Z]{4}/.test(p) || p.length <= 8 || p.length > 4296) throw new Error('that is not a BBQr frame');
    const count = parseInt(p.slice(4, 6), 36), index = parseInt(p.slice(6, 8), 36), body = p.slice(8);
    if (!count || index >= count) throw new Error('invalid BBQr frame index');
    if (total && (count !== total || ft !== p[3] || encoding !== p[2])) throw new Error('BBQr frames belong to different files');
    total = count; ft = p[3]; encoding = p[2];
    if (seen.has(index) && seen.get(index) !== body) throw new Error('conflicting BBQr frames');
    if (!seen.has(index)) { length += body.length; if (length > 4000000) throw new Error('BBQr payload is too large') }
    seen.set(index, body);
  }
  if (seen.size < total) throw new Error(`only ${seen.size} of ${total} frames scanned`);
  const out = [];
  const fullLength = seen.get(0)?.length;
  for (let i = 0; i < total; i++) {
    const s = seen.get(i);
    if (s == null) throw new Error('frame ' + i + ' is missing');
    if ((i < total - 1 && s.length !== fullLength) || s.length > fullLength || (encoding !== 'H' && i < total - 1 && s.length % 8)) throw new Error('inconsistent BBQr frame lengths');
    if (encoding === 'H') { for (const v of hexToBytes(s)) out.push(v); continue }
    let bits = 0, acc = 0;
    for (const c of s) { const v = B32.indexOf(c); if (v < 0) throw new Error('bad frame data');
      acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff) } }
    if (bits >= 5 || (bits && (acc & ((1 << bits) - 1)))) throw new Error('bad frame padding');
  }
  if (out.length > 2000000) throw new Error('BBQr payload is too large');
  const raw = new Uint8Array(out);
  return { fileType: ft, raw: encoding === 'Z' ? await inflateBBQr(raw, signal) : raw };
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
