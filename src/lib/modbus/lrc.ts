/**
 * @file Modbus ASCII LRC-8.
 *
 * The longitudinal redundancy check is the two's complement of the sum of all
 * bytes (mod 256). The result is a single byte in the range 0..255.
 *
 * Example: bytes `01 03 00 00 00 01` sum to `0x05`; LRC = `(-0x05) & 0xff`
 * = `0xFB`.
 */

/**
 * Compute the Modbus ASCII LRC-8 over `data`.
 *
 * @param data - Input bytes (typically address + function + data, **not**
 *               including the LRC byte itself).
 * @returns LRC byte in the range 0..255.
 */
export function lrc8(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0, n = data.length; i < n; i++) {
    sum = (sum + data[i]) & 0xff;
  }
  return (-sum) & 0xff;
}

/**
 * Verify the trailing LRC of an ASCII frame.
 *
 * The frame (already decoded from ASCII hex to binary) is assumed to end with
 * a single LRC byte. The LRC is computed over everything except that byte.
 *
 * @param frame - Decoded ASCII frame including the trailing LRC byte.
 * @returns `true` if the trailer matches the computed LRC.
 */
export function verifyLrc(frame: Uint8Array): boolean {
  if (frame.length < 3) {
    // Minimum ASCII frame: address(1) + function(1) + lrc(1).
    return false;
  }
  const slice = frame.subarray(0, frame.length - 1);
  const expected = lrc8(slice);
  return expected === frame[frame.length - 1];
}

/**
 * Append a 1-byte LRC to `data` and return a new `Uint8Array`. Convenience
 * helper for the builder.
 */
export function appendLrc(data: Uint8Array): Uint8Array {
  const lrc = lrc8(data);
  const out = new Uint8Array(data.length + 1);
  out.set(data, 0);
  out[data.length] = lrc;
  return out;
}
