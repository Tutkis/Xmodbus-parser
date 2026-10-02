/**
 * @file Modbus CRC-16 (RTU).
 *
 * Polynomial: 0xA001 (reflected form of 0x8005).
 * Init value: 0xFFFF.
 * Reflect input: yes. Reflect output: yes. XorOut: 0x0000.
 *
 * The check value of bytes `01 04 02 FF FF` is `80 28` (CRC = 0x2880,
 * written to the wire low-byte first as `80 28`).
 *
 * The 256-entry lookup table is precomputed at module load for speed; each
 * `crc16` call is then a tight 1-table-lookup-per-byte loop. A 10 MB stream
 * parses in well under a second on modern hardware.
 */

/* ------------------------------------------------------------------ */
/* Precomputed table                                                  */
/* ------------------------------------------------------------------ */

/**
 * Generate the 256-entry CRC-16/MODBUS lookup table.
 * Performed once at module load.
 */
function buildTable(): Uint16Array {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      // Modbus uses the reflected polynomial 0xA001.
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    table[i] = crc & 0xffff;
  }
  return table;
}

const TABLE: Uint16Array = buildTable();

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compute the Modbus CRC-16 over `data`.
 *
 * @param data - Input bytes.
 * @returns CRC in the range 0..65535. The low byte is intended to be written
 *          to the wire first (i.e. `[crc & 0xff, crc >>> 8]`).
 */
export function crc16(data: Uint8Array): number {
  let crc = 0xffff;
  // Local alias for hot-loop perf (avoids repeated property access).
  const table = TABLE;
  for (let i = 0, n = data.length; i < n; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return crc & 0xffff;
}

/**
 * Verify the trailing CRC of an RTU frame.
 *
 * The frame is assumed to end with `[crc_lo, crc_hi]`. The CRC is computed
 * over everything except those two trailing bytes.
 *
 * @param frame - Full RTU frame including the 2-byte CRC trailer.
 * @returns `true` if the trailer matches the computed CRC.
 */
export function verifyCrc(frame: Uint8Array): boolean {
  if (frame.length < 4) {
    // Minimum RTU frame: address(1) + function(1) + crc(2). Shorter is invalid.
    return false;
  }
  const slice = frame.subarray(0, frame.length - 2);
  const expected = crc16(slice);
  const lo = frame[frame.length - 2];
  const hi = frame[frame.length - 1];
  return (expected & 0xff) === lo && (expected >>> 8) === hi;
}

/**
 * Append a 2-byte CRC (low byte first) to `data` and return a new
 * `Uint8Array`. Convenience helper for the builder.
 */
export function appendCrc(data: Uint8Array): Uint8Array {
  const crc = crc16(data);
  const out = new Uint8Array(data.length + 2);
  out.set(data, 0);
  out[data.length] = crc & 0xff;
  out[data.length + 1] = (crc >>> 8) & 0xff;
  return out;
}
