/** Hamming(8,4) + CRC-16-CCITT. Same numbers as optical/protocol.py. */

export function crc16Ccitt(bytes, seed = 0xffff) {
  let crc = seed;
  for (const byte of bytes) {
    crc ^= (byte << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export function nibbleHamming(nibble) {
  const d = nibble & 0x0f;
  const d3 = (d >> 3) & 1;
  const d2 = (d >> 2) & 1;
  const d1 = (d >> 1) & 1;
  const d0 = d & 1;
  const p1 = d3 ^ d2 ^ d0;
  const p2 = d3 ^ d1 ^ d0;
  const p4 = d2 ^ d1 ^ d0;
  const p8 = p1 ^ p2 ^ d3 ^ p4 ^ d2 ^ d1 ^ d0;
  return (p1 << 7) | (p2 << 6) | (d3 << 5) | (p4 << 4) | (d2 << 3) | (d1 << 2) | (d0 << 1) | p8;
}

export function nibbleUnhamming(code) {
  let bits = [];
  for (let i = 7; i >= 0; i--) bits.push((code >> i) & 1);
  let [p1, p2, d3, p4, d2, d1, d0, p8] = bits;
  const s1 = p1 ^ d3 ^ d2 ^ d0;
  const s2 = p2 ^ d3 ^ d1 ^ d0;
  const s4 = p4 ^ d2 ^ d1 ^ d0;
  const s8 = p1 ^ p2 ^ d3 ^ p4 ^ d2 ^ d1 ^ d0 ^ p8;
  const syndrome = s1 | (s2 << 1) | (s4 << 2);
  let recovered = false;
  if (s8 === 0 && syndrome === 0) {
    // clean
  } else if (s8 === 1 && syndrome >= 1 && syndrome <= 7) {
    const pos = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6 }[syndrome];
    bits[pos] ^= 1;
    [p1, p2, d3, p4, d2, d1, d0, p8] = bits;
    recovered = true;
  } else if (s8 === 1 && syndrome === 0) {
    recovered = true;
  } else {
    throw new Error("ecc-uncorrectable");
  }
  return { nibble: (d3 << 3) | (d2 << 2) | (d1 << 1) | d0, recovered };
}

export function eccEncode(payload) {
  const out = [];
  for (const byte of payload) {
    out.push(nibbleHamming((byte >> 4) & 0x0f));
    out.push(nibbleHamming(byte & 0x0f));
  }
  return Uint8Array.from(out);
}

export function eccDecode(block) {
  if (block.length % 2) throw new Error("ecc-odd-length");
  const out = [];
  let recovered = false;
  for (let i = 0; i < block.length; i += 2) {
    const hi = nibbleUnhamming(block[i]);
    const lo = nibbleUnhamming(block[i + 1]);
    out.push((hi.nibble << 4) | lo.nibble);
    recovered = recovered || hi.recovered || lo.recovered;
  }
  return { bytes: Uint8Array.from(out), recovered };
}
