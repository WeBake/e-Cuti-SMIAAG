// Ujian SSO_LOGIN (log masuk sekali dari Profil Guru). Jalankan: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { bina } = require('./harness');

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

test('SSO_LOGIN: menolak tandatangan salah, tiket diubah, tamat tempoh, guna semula, audience lain, emel tidak sah', () => {
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
  assert.equal(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'bukan-emel' }) }).success, false);
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
  assert.match(post({ action: 'GET_UNLIMITED_DATES' }).versi, /^\d+\.\d+$/);
});

test('guru baharu dari Profil Guru: akaun e-Cuti dicipta automatik sebagai GURU, tanpa kata laluan', () => {
  const { post, props, sheets, adminToken, mel } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  const bilEmel = mel.length;
  const r = post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'Baharu@Contoh.Test', nama: '  Guru   Baharu Contoh ', kod: 'SM950' }) });
  assert.equal(r.success, true, r.message);
  assert.equal(r.emel, 'baharu@contoh.test');
  assert.equal(r.nama, 'Guru Baharu Contoh');
  assert.equal(r.role, 'GURU', 'tidak pernah ADMIN secara automatik');
  assert.equal(mel.length, bilEmel, 'tiada emel kata laluan dihantar');
  // boleh guna sistem
  const dg = post({ action: 'GET_DATA_GURU', token: r.token }).data;
  const s = dg.find((x) => x.SENDIRI);
  assert.equal(s.NAMA_GURU, 'Guru Baharu Contoh', 'baris DATA_GURU ditambah dan dipadankan ikut emel');
  assert.equal(s.BIL_CUTI_TAHUNAN_BERBAKI, 12, 'kelayakan lalai 12 hari setahun; admin ubah secara manual');
  assert.equal(sheets.DATA_GURU.rows.find((x) => x.includes('baharu@contoh.test'))[1], 12, 'angka 12 ditulis dalam Sheet supaya admin nampak');
  // kali kedua: tiada akaun atau baris berganda
  assert.equal(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'baharu@contoh.test', nama: 'Guru Baharu Contoh' }) }).success, true);
  assert.equal(sheets.Users.rows.filter((x) => x[0] === 'baharu@contoh.test').length, 1);
  assert.equal(sheets.DATA_GURU.rows.filter((x) => x.includes('baharu@contoh.test')).length, 1);
  // admin nampak tanda Profil Guru
  const u = post({ action: 'GET_USERS', token: adminToken }).data.find((x) => x.emel === 'baharu@contoh.test');
  assert.equal(u.ssoSahaja, true);
  assert.equal(post({ action: 'GET_USERS', token: adminToken }).data.find((x) => x.emel === 'guru.satu@contoh.test').ssoSahaja, false);
});

test('akaun automatik tidak boleh log masuk dengan kata laluan atau menetapkan kata laluan melalui reset', () => {
  const { post, props, mel } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'baharu@contoh.test', nama: 'Guru Baharu' }) });
  ['', 'TukarSaya123', 'x'].forEach((p) => assert.equal(post({ action: 'LOGIN', emel: 'baharu@contoh.test', password: p }).success, false));
  assert.match(post({ action: 'LOGIN', emel: 'baharu@contoh.test', password: 'apa-apa' }).message, /melalui Sistem Profil Guru/);
  const n = mel.length;
  assert.equal(post({ action: 'MINTA_KOD_RESET', emel: 'baharu@contoh.test' }).success, true, 'mesej generik');
  assert.equal(mel.length, n, 'tiada kod reset dihantar');
});

test('akaun yang dipadam admin e-Cuti tidak dicipta semula; akaun sedia ada kekal dengan kata laluan sendiri', () => {
  const { post, props, adminToken, guruSementara } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'baharu@contoh.test', nama: 'Guru Baharu' }) });
  post({ action: 'DELETE_USER', token: adminToken, emelTarget: 'baharu@contoh.test' });
  assert.match(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'baharu@contoh.test', nama: 'Guru Baharu' }) }).message, /telah dipadam oleh pentadbir/);
  // akaun lama: SSO dan kata laluan kedua-duanya berfungsi
  assert.equal(post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA) }).success, true);
  assert.equal(post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: guruSementara }).success, true);
});

test('nama berformula dalam tiket dineutralkan sebelum ditulis ke Sheet', () => {
  const { post, props, sheets } = bina();
  props.ECUTI_SSO_SECRET = RAHSIA;
  post({ action: 'SSO_LOGIN', tiket: tiket(RAHSIA, { emel: 'f@contoh.test', nama: '=IMPORTXML("http://jahat")' }) });
  const row = sheets.Users.rows.find((x) => x[0] === 'f@contoh.test');
  assert.ok(row[1].startsWith("'="));
});
