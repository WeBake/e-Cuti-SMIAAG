// Ujian SSO_LOGIN (log masuk sekali dari Profil Guru). Jalankan: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto'), fs = require('fs'), vm = require('vm'), path = require('path');

function bina() {
  const sheets = {}, cache = {}, props = {};
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
      newBlob: (d) => ({ getDataAsString: () => Buffer.from(d.map((x) => (x + 256) % 256)).toString('utf8') }),
      formatDate: (d) => d.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFoldersByName: () => ({ hasNext: () => false }) },
    MailApp: { sendEmail() {} }, Logger: { log() {} },
    ContentService: { createTextOutput: (s) => ({ setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 1 } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  const post = (p) => ctx.doPost({ postData: { contents: JSON.stringify(p) } });
  ctx.setupAdminPertama();
  let tok = post({ action: 'LOGIN', emel: 'admin@smiaag.edu.my', password: 'TukarSaya123' }).token;
  post({ action: 'CHANGE_PASSWORD', token: tok, oldPassword: 'TukarSaya123', newPassword: 'Baru1234' });
  tok = post({ action: 'LOGIN', emel: 'admin@smiaag.edu.my', password: 'Baru1234' }).token;
  post({ action: 'ADD_USER', token: tok, emel: 'guru.satu@contoh.test', nama: 'Guru Contoh Satu', role: 'GURU', tempPassword: 'TukarSaya123' });
  return { ctx, post, props, sheets };
}

// Tiket dibina tepat seperti backend/Ecuti.gs dalam Profil Guru
function tiket(rahsia, ubah = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const p = Buffer.from(JSON.stringify({ v: 1, iss: 'smiaag-profil', aud: 'ecuti', emel: 'guru.satu@contoh.test', nama: 'Guru Contoh Satu', kod: 'SM901', iat, exp: iat + 60, n: crypto.randomUUID(), ...ubah })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', rahsia).update(p).digest('base64url');
}
const RAHSIA = 'a'.repeat(64);

test('SSO_LOGIN: tiket sah mencipta sesi dengan peranan daripada tab Users e-Cuti', () => {
  const { post, props } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  const r = post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'Guru.Satu@Contoh.Test' }) });
  assert.equal(r.success, true, r.message);
  assert.equal(r.emel, 'guru.satu@contoh.test');
  assert.equal(r.role, 'GURU');
  assert.equal(r.mestiTukarPassword, false);
  assert.equal(post({ action: 'GET_LEAVE_APPLICATIONS', token: r.token }).success, true, 'token sesi boleh digunakan');
});

test('SSO_LOGIN: menolak tandatangan salah, tiket diubah, tamat tempoh, guna semula, audience lain, emel tiada', () => {
  const { post, props } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  assert.equal(post({ action: 'SSO_LOGIN', tiket: tiket('kunci-lain') }).success, false);
  const t = tiket(RAHSIA);
  const [p, sig] = t.split('.');
  const palsu = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), emel: 'admin@smiaag.edu.my' })).toString('base64url');
  assert.equal(post({ action: 'SSO_LOGIN', tiket: palsu + '.' + sig }).success, false, 'emel ditukar kepada admin');
  const lama = Math.floor(Date.now() / 1000) - 600;
  assert.match(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { iat: lama, exp: lama + 60 }) }).message, /tamat tempoh/);
  assert.equal(post({ action: 'SSO_LOGIN', tiket: t }).success, true);
  assert.match(post({ action: 'SSO_LOGIN', tiket: t }).message, /sudah digunakan/);
  assert.equal(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { aud: 'lain' }) }).success, false);
  assert.match(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'tiada@contoh.test' }) }).message, /tiada akaun aktif/);
  assert.equal(post({ action: 'SSO_LOGIN', tiket: 'bukan-tiket' }).success, false);
  assert.equal(post({ action: 'SSO_LOGIN' }).success, false);
});

test('SSO_LOGIN: ditolak jika ECUTI_SSO_SECRET belum disediakan; log masuk biasa tidak terjejas', () => {
  const { post } = bina();
  assert.match(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA) }).message, /belum disediakan/);
  assert.equal(post({ action: 'LOGIN', emel: 'admin@smiaag.edu.my', password: 'Baru1234' }).success, true);
});

test('GET_UNLIMITED_DATES memulangkan versi server untuk label di bawah halaman', () => {
  const { post } = bina();
  assert.equal(post({ action: 'GET_UNLIMITED_DATES' }).versi, '2.3');
});
