const crcTable = (() => {
  const t = new Uint32Array(256);
  for(let n=0;n<256;n++) {let c=n;for(let k=0;k<8;k++) c=c&1 ? (0xedb88320^(c>>>1)) : (c>>>1);t[n]=c>>>0;}
  return t;
})();
function crc32(bytes) {let c=0xffffffff;for(let i=0;i<bytes.length;i++) c=crcTable[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
// ZIP STORE: MP4 data is already compressed. ZIP64 is intentionally unsupported.
export class ZipArchive {
  chunks = [];
  directory = [];
  offset = 0;
  size = 0;
  add(filename, bytes) {
    if (this.directory.length >= 65535) throw Error('Too many ZIP entries.');
    const name = new TextEncoder().encode(filename), crc = crc32(bytes);
    if (name.length > 65535 || bytes.length > 0xffffffff) throw Error('ZIP entry too large.');
    const header = new ArrayBuffer(30 + name.length), v = new DataView(header);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); v.setUint16(12, 0x21, true); // UTF-8; 1980-01-01
    v.setUint32(14, crc, true); v.setUint32(18, bytes.length, true); v.setUint32(22, bytes.length, true);
    v.setUint16(26, name.length, true); new Uint8Array(header, 30).set(name);
    const cd = new ArrayBuffer(46 + name.length), d = new DataView(cd);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true);
    d.setUint16(28, name.length, true); d.setUint32(42, this.offset, true);
    new Uint8Array(cd, 46).set(name);
    const nextOffset = this.offset + header.byteLength + bytes.length;
    const nextSize = this.size + cd.byteLength;
    if (nextOffset + nextSize + 22 > 0xffffffff) throw Error('Batch ZIP exceeds 4 GB; export fewer clips.');
    // Blobs avoid retaining all the raw output arrays after each add operation.
    this.chunks.push(header, new Blob([bytes])); this.directory.push(cd);
    this.offset = nextOffset; this.size = nextSize;
  }
  finish() {
    const footer = new ArrayBuffer(22), f = new DataView(footer);
    f.setUint32(0, 0x06054b50, true);
    f.setUint16(8, this.directory.length, true); f.setUint16(10, this.directory.length, true);
    f.setUint32(12, this.size, true); f.setUint32(16, this.offset, true);
    return new Blob([...this.chunks, ...this.directory, footer], {type: 'application/zip'});
  }
}
