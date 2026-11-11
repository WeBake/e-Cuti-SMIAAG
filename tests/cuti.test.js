// B5: cuti umum / cuti sekolah. Senarai KPM 2027 Kumpulan B diisi automatik sekali; admin boleh tambah/buang.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bina } = require('./harness');

function sedia() {
  const w = bina();
  const s = w.guruSementara;
  const t = w.post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: s }).token;
  w.post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: s, newPassword: 'rahsia123' });
  w.guru = w.post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: 'rahsia123' }).token;
  w.mohon = (mula, akhir) => w.post({ action: 'SUBMIT_LEAVE', token: w.guru, application: { startDate: mula, endDate: akhir, reasonCategory: 'Lain-Lain', reasonDetails: 'ujian', fileBase64: 'UERG', fileMimeType: 'application/pdf', fileName: 'a.pdf' } });
  return w;
}

test('cuti KPM 2027 Kumpulan B diisi automatik sekali, tepat mengikut pekeliling', () => {
  const { post, sheets, props } = sedia();
  const cuti = post({ action: 'GET_UNLIMITED_DATES' }).cuti;
  const ada = (d) => cuti.find((c) => c.tarikh === d);
  // sempadan setiap julat
  ['2027-03-06', '2027-03-14', '2027-05-22', '2027-06-06', '2027-08-28', '2027-09-05', '2027-12-04', '2027-12-31'].forEach((d) => assert.ok(ada(d), d));
  ['2027-03-05', '2027-03-15', '2027-05-14', '2027-06-07', '2027-08-27', '2027-09-06', '2027-12-03'].forEach((d) => assert.equal(ada(d), undefined, d + ' hari persekolahan'));
  // perayaan dan cuti tambahan KPM (Kumpulan B)
  ['2027-02-05', '2027-02-06', '2027-02-07', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12', '2027-05-17', '2027-05-18', '2027-05-19', '2027-05-20', '2027-05-21', '2027-10-27', '2027-10-28', '2027-10-29'].forEach((d) => assert.ok(ada(d), d));
  assert.equal(ada('2027-02-08'), undefined, '8 Feb tiada dalam pekeliling untuk Kumpulan B (admin tambah jika cuti)');
  assert.equal(ada('2027-03-08').nama, 'Cuti Penggal 1');
  assert.match(ada('2027-05-21').nama, /Wesak/);
  assert.equal(cuti.length, new Set(cuti.map((c) => c.tarikh)).size, 'tiada tarikh berganda');
  assert.equal(cuti.length, 3 + 4 + 9 + 5 + 16 + 9 + 3 + 28);
  // tidak diisi semula
  const n = sheets.CutiSekolah.rows.length;
  post({ action: 'GET_UNLIMITED_DATES' });
  assert.equal(sheets.CutiSekolah.rows.length, n);
  assert.ok(props.CUTI_KPM_2027_B_DIISI);
});

test('cuti tidak dikira sebagai hari cuti dan tidak boleh dimohon', () => {
  const w = sedia();
  // Khamis 4 Mac – Selasa 16 Mac 2027: 4,5 (Kha,Jum) + 15,16 (Isn,Sel) = 4 hari; 6–14 Mac cuti penggal
  const r = w.mohon('2027-03-04', '2027-03-16');
  assert.equal(r.success, true, r.message);
  const a = w.post({ action: 'GET_LEAVE_APPLICATIONS', token: w.guru });
  assert.equal(a.data[0].totalDays, 4);
  assert.equal(a.usage['2027-03-08'], undefined, 'tiada kuota dipakai pada hari cuti');
  assert.equal(a.usage['2027-03-15'], 1);
  assert.match(w.mohon('2027-06-01', '2027-06-04').message, /Tiada hari persekolahan/);
});

test('admin menambah dan membuang cuti; guru biasa tidak boleh', () => {
  const w = sedia();
  assert.equal(w.post({ action: 'ADD_UNLIMITED_DATE', token: w.guru, jenis: 'CUTI', dates: ['2027-08-31'] }).success, false);
  const r = w.post({ action: 'ADD_UNLIMITED_DATE', token: w.adminToken, jenis: 'CUTI', dates: ['2027-08-31', '2027-08-31', '2027-09-16'], nama: '=Hari Kebangsaan' });
  assert.equal(r.success, true);
  assert.deepEqual([...r.added], ['2027-09-16'], '31 Ogos sudah dalam Cuti Penggal 2; tarikh berganda diabaikan');
  const cuti = w.post({ action: 'GET_UNLIMITED_DATES' }).cuti;
  assert.equal(cuti.find((c) => c.tarikh === '2027-09-16').nama, "'=Hari Kebangsaan", 'formula dineutralkan');
  assert.match(w.mohon('2027-09-16', '2027-09-16').message, /Tiada hari persekolahan/);
  assert.equal(w.post({ action: 'REMOVE_UNLIMITED_DATE', token: w.adminToken, jenis: 'CUTI', date: '2027-09-16' }).success, true);
  assert.equal(w.mohon('2027-09-16', '2027-09-16').success, true, 'boleh dimohon selepas cuti dibuang');
  // senarai sedia ada (tanpa had, Sabtu) tidak terjejas
  assert.equal(w.post({ action: 'ADD_UNLIMITED_DATE', token: w.adminToken, dates: ['2027-07-01'] }).success, true);
  assert.deepEqual([...w.post({ action: 'GET_UNLIMITED_DATES' }).data], ['2027-07-01']);
});
