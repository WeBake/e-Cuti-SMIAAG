// B1: baki cuti dipadankan ikut EMEL, bukan ejaan nama. Jalankan: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { bina } = require('./harness');

function sedia() {
  const w = bina();
  const { post, sheets, guruSementara } = w;
  let t = post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: guruSementara }).token;
  post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: guruSementara, newPassword: 'rahsia123' });
  w.guruToken = post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: 'rahsia123' }).token;
  w.dataGuru = (rows) => { post({ action: 'GET_DATA_GURU', token: w.adminToken }); sheets.DATA_GURU.rows.length = 0; rows.forEach((r) => sheets.DATA_GURU.rows.push(r)); };
  return w;
}

test('nama sama (beza huruf besar/kecil): dipadankan ikut nama, guru nampak kelayakan sendiri sahaja', () => {
  const w = sedia();
  w.dataGuru([['NAMA_GURU', 'BIL_CUTI_TAHUNAN_BERBAKI', 'EMEL'], ['GURU  CONTOH SATU', 12, ''], ['Guru Lain', 9, '']]);
  const g = w.post({ action: 'GET_DATA_GURU', token: w.guruToken }).data;
  const s = g.find((x) => x.SENDIRI);
  assert.equal(s.NAMA_GURU, 'GURU  CONTOH SATU');
  assert.equal(s.BIL_CUTI_TAHUNAN_BERBAKI, 12);
  assert.equal(g.find((x) => x.NAMA_GURU === 'Guru Lain').BIL_CUTI_TAHUNAN_BERBAKI, null, 'kelayakan guru lain disorok');
  assert.equal(s.EMEL, undefined, 'emel tidak dihantar kepada bukan admin');
  const a = w.post({ action: 'GET_DATA_GURU', token: w.adminToken }).data;
  assert.equal(a[0].PADAN, 'NAMA'); assert.equal(a[0].EMEL, 'guru.satu@contoh.test');
  assert.equal(a[1].PADAN, '', 'tiada akaun: ditanda untuk admin');
});

test('ejaan nama berbeza: lajur EMEL menentukan padanan, dan permohonan membawa nama DATA_GURU (guruData)', () => {
  const w = sedia();
  w.dataGuru([['NAMA_GURU', 'BIL_CUTI_TAHUNAN_BERBAKI', 'EMEL'], ['G. Contoh Satu bin Fulan', 15, 'Guru.Satu@Contoh.Test']]);
  const s = w.post({ action: 'GET_DATA_GURU', token: w.guruToken }).data.find((x) => x.SENDIRI);
  assert.equal(s.BIL_CUTI_TAHUNAN_BERBAKI, 15, 'dipadankan walaupun nama akaun "Guru Contoh Satu"');
  const r = w.post({ action: 'SUBMIT_LEAVE', token: w.guruToken, application: { startDate: '2026-11-16', endDate: '2026-11-17', reasonCategory: 'Lain-Lain', reasonDetails: 'ujian', fileBase64: 'UERG', fileMimeType: 'application/pdf', fileName: 'a.pdf' } });
  assert.equal(r.success, true, r.message);
  const apps = w.post({ action: 'GET_LEAVE_APPLICATIONS', token: w.adminToken }).data;
  assert.equal(apps[0].teacherName, 'Guru Contoh Satu');
  assert.equal(apps[0].guruData, 'G. Contoh Satu bin Fulan');
});

test('isiEmelDataGuru mengisi lajur EMEL bagi nama yang sepadan dan melaporkan yang tiada akaun', () => {
  const w = sedia();
  w.dataGuru([['NAMA_GURU', 'BIL_CUTI_TAHUNAN_BERBAKI'], ['guru contoh satu', 12], ['Tiada Akaun', 5]]);
  const mesej = w.ctx.isiEmelDataGuru();
  assert.match(mesej, /^1 emel diisi\..*Tiada Akaun/);
  assert.equal(w.sheets.DATA_GURU.rows[0][2], 'EMEL');
  assert.equal(w.sheets.DATA_GURU.rows[1][2], 'guru.satu@contoh.test');
  assert.match(w.ctx.isiEmelDataGuru(), /^0 emel diisi/);
});
