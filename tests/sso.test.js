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
  assert.match(post({ action: 'GET_UNLIMITED_DATES' }).versi, /^\d+\.\d+$/);
});
