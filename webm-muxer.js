(function (root) {
  // Narrow WebM writer: one VP8 video track, millisecond timecodes, no audio.
  const concat = parts => {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  };
  const id = hex => Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
  function size(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid EBML size');
    const number = BigInt(value);
    for (let length = 1; length <= 8; length++) {
      if (number >= (1n << BigInt(length * 7)) - 1n) continue;
      let encoded = number | (1n << BigInt(length * 7));
      const bytes = new Uint8Array(length);
      for (let index = length - 1; index >= 0; index--) { bytes[index] = Number(encoded & 255n); encoded >>= 8n; }
      return bytes;
    }
    throw new Error('EBML element too large');
  }
  function integer(value) {
    let number = BigInt(value);
    const result = [];
    do { result.unshift(Number(number & 255n)); number >>= 8n; } while (number);
    return new Uint8Array(result);
  }
  function signed(value) {
    let length = 1;
    while (value < -(2 ** (length * 8 - 1)) || value >= 2 ** (length * 8 - 1)) length++;
    let number = BigInt.asUintN(length * 8, BigInt(value));
    const bytes = new Uint8Array(length);
    for (let index = length - 1; index >= 0; index--) { bytes[index] = Number(number & 255n); number >>= 8n; }
    return bytes;
  }
  const element = (tag, data) => concat([id(tag), size(data.length), data]);
  const uint = (tag, value) => element(tag, integer(value));
  const text = (tag, value) => element(tag, new TextEncoder().encode(value));
  const master = (tag, children) => element(tag, concat(children));
  function float(tag, value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value);
    return element(tag, bytes);
  }

  function mux({ chunks, width, height, durationMs, frameDurationMs = 100, colorSpace = null }) {
    if (!(durationMs > 0 && durationMs <= 30000) || !chunks.length) throw new Error('Invalid clip duration');
    const ordered = [...chunks].sort((a, b) => a.timestamp - b.timestamp);
    if (!Number.isInteger(durationMs) || ordered.length !== Math.ceil(durationMs / frameDurationMs)) throw new Error('Incomplete encoded video');
    if (ordered[0].timestamp !== 0 || !ordered[0].key) throw new Error('Video must start with a key frame');
    const blocks = ordered.map((chunk, index) => {
      const time = chunk.timestamp / 1000;
      if (!Number.isInteger(time) || time !== index * frameDurationMs || time >= durationMs) throw new Error('Invalid video timestamp');
      const header = new Uint8Array([0x81, 0, 0, chunk.key ? 0x80 : 0]);
      new DataView(header.buffer).setInt16(1, time);
      if (time + frameDurationMs > durationMs) {
        header[3] = 0;
        return master('A0', [element('A1', concat([header, chunk.data])), uint('9B', durationMs - time), ...(!chunk.key ? [element('FB', signed(-frameDurationMs))] : [])]);
      }
      return element('A3', concat([header, chunk.data]));
    });
    const ebml = master('1A45DFA3', [uint('4286', 1), uint('42F7', 1), uint('42F2', 4), uint('42F3', 8), text('4282', 'webm'), uint('4287', 4), uint('4285', 2)]);
    const info = master('1549A966', [uint('2AD7B1', 1000000), float('4489', durationMs), text('4D80', 'PE Loop'), text('5741', 'PE Loop')]);
    const color = [];
    if (colorSpace) {
      const matrices = { bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };
      const transfers = { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13 };
      const primaries = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9 };
      color.push(master('55B0', [uint('55B1', matrices[colorSpace.matrix] ?? 2), uint('55B2', 8), uint('55B9', colorSpace.fullRange === true ? 2 : colorSpace.fullRange === false ? 1 : 0), uint('55BA', transfers[colorSpace.transfer] ?? 2), uint('55BB', primaries[colorSpace.primaries] ?? 2)]));
    }
    const tracks = master('1654AE6B', [master('AE', [uint('D7', 1), uint('73C5', 1), uint('83', 1), text('86', 'V_VP8'), uint('23E383', frameDurationMs * 1000000), master('E0', [uint('B0', width), uint('BA', height), ...color])])]);
    const cluster = master('1F43B675', [uint('E7', 0), ...blocks]);
    return new Blob([ebml, master('18538067', [info, tracks, cluster])], { type: 'video/webm' });
  }
  const api = { mux, size };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WebMMuxer = api;
})(globalThis);
