// B3: kata laluan lebih kuat. Jalankan: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { bina } = require('./harness');

test('pengguna baharu menerima kata laluan sementara RAWAK (bukan satu kata laluan sama), dihantar ke emel dan dipulangkan sekali', () => {
  const { post, adminToken, mel, guruSementara } = bina();
  const r = post({ action: 'ADD_USER', token: adminToken, emel: 'guru.dua@contoh.test', nama: 'Guru Contoh Dua', role: 'GURU', tempPassword: 'TukarSaya123' });
  assert.equal(r.success, true);
  assert.match(r.tempPassword, /^[A-HJ-NP-Za-km-z2-9]{10}$/, 'tanpa aksara mengelirukan');
  assert.notEqual(r.tempPassword, 'TukarSaya123', 'kata laluan daripada klien diabaikan');
  assert.notEqual(r.tempPassword, guruSementara, 'berbeza bagi setiap pengguna');
  assert.equal(r.emelDihantar, true);
  assert.ok(mel.some((m) => m.to === 'guru.dua@contoh.test' && m.body.includes(r.tempPassword)));
  assert.equal(post({ action: 'LOGIN', emel: 'guru.dua@contoh.test', password: 'TukarSaya123' }).success, false);
  const l = post({ action: 'LOGIN', emel: 'guru.dua@contoh.test', password: r.tempPassword });
  assert.equal(l.success, true);
  assert.equal(l.mestiTukarPassword, true);
});

test('kata laluan baharu minimum 8 aksara (tukar dan reset); kata laluan lama pendek masih boleh log masuk', () => {
  const { post, guruSementara, mel, sheets, ctx } = bina();
  const t = post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: guruSementara }).token;
  assert.match(post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: guruSementara, newPassword: 'abc1234' }).message, /minimum 8/);
  assert.equal(post({ action: 'CHANGE_PASSWORD', token: t, oldPassword: guruSementara, newPassword: 'abc12345' }).success, true);
  // akaun lama dengan kata laluan 6 aksara (ditetapkan sebelum peraturan baharu) masih boleh log masuk
  const rows = sheets.Users.rows, i = rows.findIndex((r) => r[0] === 'guru.satu@contoh.test');
  rows[i][3] = ctx.hashPassword('lama12', rows[i][4]);
  assert.equal(post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: 'lama12' }).success, true);
  // reset
  post({ action: 'MINTA_KOD_RESET', emel: 'guru.satu@contoh.test' });
  const kod = /Kod 6-digit anda ialah: (\d{6})/.exec(mel[mel.length - 1].body)[1];
  assert.ok(+kod >= 100000 && +kod <= 999999);
  assert.equal(post({ action: 'SAHKAN_KOD_RESET', emel: 'guru.satu@contoh.test', kod, newPassword: 'pendek1' }).success, false);
  assert.equal(post({ action: 'SAHKAN_KOD_RESET', emel: 'guru.satu@contoh.test', kod, newPassword: 'cukuppanjang1' }).success, true);
  assert.equal(post({ action: 'LOGIN', emel: 'guru.satu@contoh.test', password: 'cukuppanjang1' }).success, true);
});

test('kod reset dan kata laluan sementara tidak berulang dan tidak menggunakan Math.random', () => {
  const { ctx } = bina();
  const asal = Math.random; Math.random = () => { throw new Error('Math.random tidak patut dipanggil'); };
  try {
    const kod = new Set(), kl = new Set();
    for (let i = 0; i < 200; i++) { kod.add(ctx.janaKodReset()); kl.add(ctx.janaKataLaluanSementara()); }
    assert.ok(kod.size > 190, 'kod reset pelbagai');
    assert.equal(kl.size, 200);
    [...kod].forEach((k) => assert.match(k, /^[1-9]\d{5}$/));
  } finally { Math.random = asal; }
});
