// B4: cache sesi. Kelajuan tidak boleh melonggarkan keselamatan: pembatalan mesti berkuat kuasa serta-merta.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bina } = require('./harness');

function kiraBacaan(sheet) { let n = 0; const asal = sheet.getDataRange.bind(sheet); sheet.getDataRange = () => { n++; return asal(); }; return () => n; }

test('permintaan kedua tidak membaca tab Sessions (sesi daripada cache)', () => {
  const { post, adminToken, sheets } = bina();
  post({ action: 'GET_USERS', token: adminToken });
  const bacaan = kiraBacaan(sheets.Sessions);
  assert.equal(post({ action: 'GET_USERS', token: adminToken }).success, true);
  assert.equal(bacaan(), 0);
});

test('log keluar, tukar peranan, padam pengguna dan tukar kata laluan membatalkan sesi dalam cache serta-merta', () => {
  const { post, adminToken } = bina();
  const baru = (emel, role) => { const s = post({ action: 'ADD_USER', token: adminToken, emel, nama: 'Guru ' + emel, role }).tempPassword;
    let t = post({ action: 'LOGIN', emel, password: s }).token; post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: s, newPassword: 'rahsia123' });
    t = post({ action: 'LOGIN', emel, password: 'rahsia123' }).token; assert.equal(post({ action: 'GET_DATA_GURU', token: t }).success, true); return t; };
  // log keluar
  const a = baru('a@contoh.test', 'GURU');
  post({ action: 'LOGOUT', token: a });
  assert.equal(post({ action: 'GET_DATA_GURU', token: a }).success, false);
  // admin diturunkan kepada GURU: token lama tidak lagi sah
  const b = baru('b@contoh.test', 'ADMIN');
  assert.equal(post({ action: 'GET_USERS', token: b }).success, true);
  post({ action: 'EDIT_USER', token: adminToken, targetEmel: 'b@contoh.test', emel: 'b@contoh.test', nama: 'Guru b', role: 'GURU' });
  assert.equal(post({ action: 'GET_USERS', token: b }).success, false);
  // padam pengguna
  const c = baru('c@contoh.test', 'GURU');
  post({ action: 'DELETE_USER', token: adminToken, emelTarget: 'c@contoh.test' });
  assert.equal(post({ action: 'GET_DATA_GURU', token: c }).success, false);
  // tukar kata laluan: sesi lain pengguna itu terbatal
  const d = baru('d@contoh.test', 'GURU');
  const d2 = post({ action: 'LOGIN', emel: 'd@contoh.test', password: 'rahsia123' }).token;
  post({ action: 'CHANGE_PASSWORD', token: d2, oldPassword: 'rahsia123', newPassword: 'rahsia456' });
  assert.equal(post({ action: 'GET_DATA_GURU', token: d }).success, false);
});

test('sesi tamat tempoh ditolak walaupun masih dalam cache; token pelik ditolak', () => {
  const { post, adminToken, cache } = bina();
  post({ action: 'GET_USERS', token: adminToken });
  const k = 'SESI_' + adminToken, s = JSON.parse(cache[k]);
  cache[k] = JSON.stringify({ ...s, luput: Date.now() - 1000 });
  assert.match(post({ action: 'GET_USERS', token: adminToken }).message, /tamat tempoh/);
  assert.equal(post({ action: 'GET_USERS', token: { $ne: 1 } }).success, false);
  assert.equal(post({ action: 'GET_USERS', token: 'x'.repeat(500) }).success, false);
});
