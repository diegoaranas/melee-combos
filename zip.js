// Minimal zip writer and reader (deflate, no zip64: archives must stay under 4 GB).
// Uses only zlib, so it works inside the compiled exe without extra dependencies.
const fs = require("fs");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// entries: [{ name, data: Buffer }] or [{ name, file: path }]. Files are read one at a time.
function writeZip(out, entries) {
  const fd = fs.openSync(out, "w");
  const central = [];
  let offset = 0;
  const write = (b) => { fs.writeSync(fd, b); offset += b.length; };
  for (const e of entries) {
    const data = e.data ?? fs.readFileSync(e.file);
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // utf-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    central.push({ name, crc, comp: comp.length, size: data.length, offset });
    write(local); write(name); write(comp);
    if (offset > 0xffffffff) throw new Error("zip too large (over 4 GB)");
  }
  const cdStart = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(8, 10);
    h.writeUInt32LE(0, 12);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.comp, 20);
    h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.name.length, 28);
    h.writeUInt32LE(c.offset, 42);
    write(h); write(c.name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12);
  end.writeUInt32LE(cdStart, 16);
  write(end);
  fs.closeSync(fd);
  return offset;
}

// Returns [{ name, read() -> Buffer }]; entries are inflated only when read.
function readZip(file) {
  const fd = fs.openSync(file, "r");
  const size = fs.fstatSync(fd).size;
  const tail = Buffer.alloc(Math.min(size, 65557));
  fs.readSync(fd, tail, 0, tail.length, size - tail.length);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error(`${file} is not a zip file`);
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdStart = tail.readUInt32LE(eocd + 16);
  const cd = Buffer.alloc(cdSize);
  fs.readSync(fd, cd, 0, cdSize, cdStart);
  const entries = [];
  for (let p = 0, i = 0; i < count; i++) {
    const method = cd.readUInt16LE(p + 10);
    const comp = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
    const local = cd.readUInt32LE(p + 42);
    const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    entries.push({
      name,
      read() {
        const lh = Buffer.alloc(30);
        fs.readSync(fd, lh, 0, 30, local);
        const start = local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        const buf = Buffer.alloc(comp);
        fs.readSync(fd, buf, 0, comp, start);
        if (method === 0) return buf;
        if (method === 8) return zlib.inflateRawSync(buf);
        throw new Error(`${name}: unsupported compression method ${method}`);
      },
    });
  }
  return entries;
}

module.exports = { writeZip, readZip, crc32 };
