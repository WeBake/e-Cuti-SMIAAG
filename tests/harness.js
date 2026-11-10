// Simulasi Apps Script untuk ujian (tiada Sheet/Drive sebenar). Guna: const { bina } = require('./harness');
// bina() memuat Code.gs, mencipta admin (admin@smiaag.edu.my / Baru1234) dan seorang guru (guru.satu@contoh.test).
const crypto = require('crypto'), fs = require('fs'), vm = require('vm'), path = require('path');

function bina() {
  const sheets = {}, cache = {}, props = {}, mel = [], files = {};
  const mkSheet = () => { const rows = []; return { rows,
    getRange(r, c, nr = 1, nc = 1) { return {
      getValues: () => { const o = []; for (let i = 0; i < nr; i++) { o.push([]); for (let j = 0; j < nc; j++) o[i].push((rows[r - 1 + i] || [])[c - 1 + j] ?? ''); } return o; },
      setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { rows[r - 1 + i] = rows[r - 1 + i] || []; rows[r - 1 + i][c - 1 + j] = x; })); return { setFontWeight() {} }; },
      setValue: (x) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = x; },
      clearContent: () => { for (let i = 0; i < nr; i++) rows[r - 1 + i] = []; }, setFontWeight: () => ({}) }; },
    getLastColumn() { return Math.max(1, ...rows.map((r) => r.length)); },
    getLastRow() { let n = rows.length; while (n > 0 && !(rows[n - 1] || []).some((x) => x !== '' && x !== undefined)) n--; return n; },
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), this.getLastColumn()); },
    appendRow(v) { rows.length = this.getLastRow(); rows.push(v); }, deleteRow(i) { rows.splice(i - 1, 1); }, setFrozenRows() {} }; };
  const ss = { getSheetByName: (n) => sheets[n], insertSheet: (n) => (sheets[n] = mkSheet()) };
  const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const ctx = { console, JSON, Date, Math, parseInt, Array, String,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {} },
    Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 },
      computeDigest: (a, s) => signed(crypto.createHash('sha256').update(s).digest()),
      computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', String(k)).update(String(v)).digest()),
      base64EncodeWebSafe: (b) => Buffer.from(b.map((x) => (x + 256) % 256)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Decode: (s) => signed(Buffer.from(s, 'base64')),
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      newBlob: (d, m, n) => ({ d, m, n, getDataAsString: () => Buffer.from(d.map((x) => (x + 256) % 256)).toString('utf8') }),
      formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; },
      removeAll: (ks) => ks.forEach((k) => { delete cache[k]; }), getAll: (ks) => Object.fromEntries(ks.filter((k) => k in cache).map((k) => [k, cache[k]])) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => ({ createFile: (b) => { const id = 'f' + Object.keys(files).length; files[id] = { blob: b, trashed: false }; return { getId: () => id }; } }),
      getFileById: (id) => { if (!files[id]) throw new Error('tiada fail'); return { getBlob: () => ({ getContentType: () => files[id].blob.m, getBytes: () => files[id].blob.d }), setTrashed: (t) => { files[id].trashed = t; }, isTrashed: () => files[id].trashed }; } },
    MailApp: { sendEmail(to, subject, body) { mel.push({ to, subject, body }); } }, Logger: { log() {} },
    ContentService: { createTextOutput: (s) => ({ setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 1 } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  const post = (p) => ctx.doPost({ postData: { contents: JSON.stringify(p) } });
  ctx.setupAdminPertama();
  let tok = post({ action: 'LOGIN', emel: 'admin@smiaag.edu.my', password: 'TukarSaya123' }).token;
  post({ action: 'CHANGE_PASSWORD', token: tok, oldPassword: 'TukarSaya123', newPassword: 'Baru1234' });
  tok = post({ action: 'LOGIN', emel: 'admin@smiaag.edu.my', password: 'Baru1234' }).token;
  const g = post({ action: 'ADD_USER', token: tok, emel: 'guru.satu@contoh.test', nama: 'Guru Contoh Satu', role: 'GURU' });
  return { ctx, post, props, sheets, cache, mel, files, adminToken: tok, guruSementara: g.tempPassword };
}

module.exports = { bina };
