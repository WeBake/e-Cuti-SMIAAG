// B8 + sandaran: tempoh simpanan 2 tahun (lampiran, log) dan sandaran mingguan bergilir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bina } = require('./harness');

function sedia() {
  const w = bina();
  const s = w.guruSementara;
  const t = w.post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: s }).token;
  w.post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: s, newPassword: 'rahsia123' });
  w.guru = w.post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: 'rahsia123' }).token;
  w.mohon = (mula, akhir) => w.post({ action: 'SUBMIT_LEAVE', token: w.guru, application: { startDate: mula, endDate: akhir, reasonCategory: 'Lain-Lain', reasonDetails: 'ujian', fileBase64: 'UERG', fileMimeType: 'application/pdf', fileName: 'mc.pdf' } });
  return w;
}

test('lampiran melebihi 2 tahun dibuang ke Trash; rekod permohonan dan lampiran baharu kekal', () => {
  const w = sedia();
  const lama = w.mohon('2024-03-04', '2024-03-05'), baru = w.mohon('2026-11-16', '2026-11-16');
  assert.equal(lama.success && baru.success, true, lama.message || baru.message);
  assert.match(w.ctx.bersihkanLampiranLama(), /^Lampiran: 1 fail/);
  const ids = Object.keys(w.files);
  assert.equal(w.files[ids[0]].trashed, true);
  assert.equal(w.files[ids[1]].trashed, false);
  const apps = w.post({ action: 'GET_LEAVE_APPLICATIONS', token: w.adminToken }).data;
  assert.equal(apps.length, 2, 'rekod permohonan kekal');
  assert.equal(apps.find((a) => a.id === lama.id).hasAttachment, false);
  assert.equal(apps.find((a) => a.id === baru.id).hasAttachment, true);
  assert.match(w.post({ action: 'GET_ATTACHMENT', token: w.adminToken, appId: lama.id }).message, /dipadam selepas tempoh simpanan 2 tahun/);
  assert.equal(w.post({ action: 'GET_ATTACHMENT', token: w.adminToken, appId: baru.id }).success, true);
  assert.match(w.ctx.bersihkanLampiranLama(), /^Lampiran: 0 fail/, 'tidak diulang');
});

test('log aktiviti melebihi 2 tahun dibuang; yang baharu kekal', () => {
  const w = sedia();
  const log = w.sheets.Log.rows, n = log.length;
  log.splice(1, 0, [new Date('2023-01-05T00:00:00Z'), 'x@contoh.test', 'LOGIN', 'SUCCESS'], [new Date('2024-02-01T00:00:00Z'), 'x@contoh.test', 'LOGIN', 'SUCCESS']);
  assert.match(w.ctx.bersihkanLogLama(), /^Log: 2 baris/);
  assert.equal(log.length, n);
  assert.equal(log[0][0], 'Masa');
});

test('sandaran: tanpa tab Sessions, formula dineutralkan, maksimum 4 fail bergilir; pencetus dipasang sekali', () => {
  const w = sedia();
  w.post({ action: 'ADD_UNLIMITED_DATE', token: w.adminToken, jenis: 'CUTI', dates: ['2027-07-01'], nama: 'Cuti Peristiwa' });
  w.sheets.Users.rows[1][1] = '=HYPERLINK("http://jahat")';
  for (let i = 0; i < 5; i++) w.ctx.sandaranEcuti();
  const ids = JSON.parse(w.props.SANDARAN_IDS);
  assert.equal(ids.length, 4);
  assert.equal(Object.keys(w.sandaran).length, 4, 'tiada fail kelima');
  const f = w.sandaran[ids[0]];
  assert.match(f.getName(), /^SANDARAN e-Cuti SMIAAG \d{4}-\d{2}-\d{2}/);
  assert.equal(f.getSheetByName('Sessions'), undefined);
  assert.equal(f.getSheetByName('Sheet1'), undefined);
  assert.ok(f.getSheetByName('Users') && f.getSheetByName('CutiSekolah') && f.getSheetByName('Log'), 'tab data disalin');
  assert.equal(f.getSheetByName('Users').rows[1][1], '\'=HYPERLINK("http://jahat")');
  assert.equal(f.getSheets().some((s) => s.getName().startsWith('~')), false);
  assert.match(w.ctx.pasangPencetus(), /dipasang/);
  assert.match(w.ctx.pasangPencetus(), /sudah wujud/);
  assert.deepEqual([...w.pencetus], ['selenggaraMingguan']);
  assert.equal(w.ctx.selenggaraMingguan().length, 3);
});
