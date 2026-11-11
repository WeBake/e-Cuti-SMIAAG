// ====================================================================
// CONFIGURATION & CONSTANTS
// ====================================================================
var SPREADSHEET_ID = ""; // <-- TAMPAL GOOGLE SHEET ID ANDA DI SINI

var SESSION_TTL_HOURS = 12; 
var MAX_LOGIN_ATTEMPTS = 8; 
var RATE_LIMIT_MINUTES = 5; 
var PASSWORD_MIN = 8; // untuk kata laluan BAHARU; kata laluan lama yang lebih pendek masih boleh log masuk
var SERVER_VERSI = "2.8"; // dipapar di bawah halaman (index.html v2.1+). Naikkan bila Code.gs berubah.

// Kelajuan: Spreadsheet dibuka sekali setiap larian; semakan tajuk tab dibuat sekali dan diingat 10 minit.
var _SS = null, _TAB = {};
function bukaSpreadsheet() {
  if (!_SS) _SS = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return _SS;
}

function pastikanTab(namaTab, senaraiHeader, semakSemula) {
  var kunciTab = namaTab + "|" + senaraiHeader.join(",");
  if (semakSemula) { delete _TAB[kunciTab]; CacheService.getScriptCache().remove("TAB_OK_" + namaTab + "_" + senaraiHeader.length); }
  if (_TAB[kunciTab]) return _TAB[kunciTab];
  var ss = bukaSpreadsheet();
  var sheet = ss.getSheetByName(namaTab);
  var cache = CacheService.getScriptCache(), kunciCache = "TAB_OK_" + namaTab + "_" + senaraiHeader.length;
  if (sheet && cache.get(kunciCache)) { _TAB[kunciTab] = sheet; return sheet; }
  sheet = _pastikanTabPenuh(ss, sheet, namaTab, senaraiHeader);
  cache.put(kunciCache, "1", 600);
  _TAB[kunciTab] = sheet;
  return sheet;
}

function _pastikanTabPenuh(ss, sheet, namaTab, senaraiHeader) {

  if (!sheet) {
    sheet = ss.insertSheet(namaTab);
    sheet.getRange(1, 1, 1, senaraiHeader.length).setValues([senaraiHeader]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    return sheet;
  }

  var currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  var missingHeaders = senaraiHeader.filter(function(h) { return currentHeaders.indexOf(h) === -1; });

  if (missingHeaders.length > 0 && currentHeaders[0] !== "") {
    var startCol = currentHeaders.length + 1;
    sheet.getRange(1, startCol, 1, missingHeaders.length).setValues([missingHeaders]).setFontWeight("bold");
  } else if (currentHeaders[0] === "") {
    sheet.getRange(1, 1, 1, senaraiHeader.length).setValues([senaraiHeader]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAppSalt() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty("APP_SECURITY_SALT");
  if (!salt) { salt = Utilities.getUuid() + "-" + new Date().getTime(); props.setProperty("APP_SECURITY_SALT", salt); }
  return salt;
}

function hashPassword(password, userSalt) {
  var appSalt = getAppSalt();
  var combined = password + userSalt + appSalt;
  var byteSignature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined, Utilities.Charset.UTF_8);
  var hexString = "";
  for (var i = 0; i < byteSignature.length; i++) {
    var byteVal = byteSignature[i]; if (byteVal < 0) byteVal += 256;
    var byteHex = byteVal.toString(16); if (byteHex.length == 1) byteHex = "0" + byteHex;
    hexString += byteHex;
  }
  return hexString;
}

// Rawak daripada UUID v4 (penjana rawak Google), bukan Math.random.
function bytesRawak(n) {
  var hex = "";
  while (hex.length < n * 2) hex += Utilities.getUuid().replace(/-/g, "").replace(/^(.{12})4/, "$1").replace(/^(.{15})[89ab]/, "$1"); // buang digit versi/varian yang tetap
  var out = [];
  for (var i = 0; i < n; i++) out.push(parseInt(hex.substr(i * 2, 2), 16));
  return out;
}

// Kata laluan sementara rawak: 10 aksara, tanpa aksara yang mengelirukan (0/O, 1/l/I)
function janaKataLaluanSementara() {
  var abjad = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // 56 aksara
  var b = bytesRawak(20), out = "";
  for (var i = 0; i < b.length && out.length < 10; i++) { if (b[i] < 224) out += abjad.charAt(b[i] % 56); } // 224 = 4 x 56, tiada berat sebelah
  while (out.length < 10) out += abjad.charAt(bytesRawak(1)[0] % 56);
  return out;
}

// Kod reset 6 digit (100000–999999)
function janaKodReset() {
  var b = bytesRawak(4);
  var n = ((b[0] * 16777216) + (b[1] * 65536) + (b[2] * 256) + b[3]);
  return (100000 + (n % 900000)).toString();
}

function sanitizeFormula(inputVal) {
  if (typeof inputVal !== "string") return inputVal;
  var trimmed = inputVal.trim();
  if (/^[=+\-@]/.test(trimmed)) return "'" + trimmed;
  return trimmed;
}

function logActivity(emel, tindakan, status) {
  try {
    var sheetLog = pastikanTab("Log", ["Masa", "Emel", "Tindakan", "Status"]);
    sheetLog.appendRow([new Date(), sanitizeFormula(emel), sanitizeFormula(tindakan), sanitizeFormula(status)]);
  } catch (e) {}
}

function checkRateLimit(emel) {
  var cache = CacheService.getScriptCache();
  var key = "LOGIN_ATTEMPTS_" + emel.toLowerCase();
  var attempts = parseInt(cache.get(key) || "0", 10);
  if (attempts >= MAX_LOGIN_ATTEMPTS) return false;
  cache.put(key, (attempts + 1).toString(), RATE_LIMIT_MINUTES * 60);
  return true;
}

function clearRateLimit(emel) {
  CacheService.getScriptCache().remove("LOGIN_ATTEMPTS_" + emel.toLowerCase());
}

// Sesi sah dicache 5 minit (kunci SESI_<token>) supaya tab Sessions tidak dibaca pada setiap permintaan.
// Cache dibuang serta-merta bila sesi dipadam (log keluar, tukar kata laluan, tukar peranan, padam pengguna): lihat bersihkanSesi.
var SESI_CACHE_SAAT = 300;
function validateSession(token, requiredRole) {
  if (!token || typeof token !== "string" || token.length > 120) return { valid: false, error: "Token sesi tidak wujud." };
  var cache = CacheService.getScriptCache(), now = new Date().getTime(), s = null;
  var c = cache.get("SESI_" + token);
  if (c) { try { s = JSON.parse(c); } catch (e) { s = null; } }
  if (!s) {
    var data = pastikanTab("Sessions", HEADER_SESSIONS).getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === token) { s = { emel: data[i][1], role: data[i][2], luput: parseInt(data[i][3], 10) }; break; }
    }
    if (!s) return { valid: false, error: "Token sesi tidak sah." };
    if (now <= s.luput) cache.put("SESI_" + token, JSON.stringify(s), SESI_CACHE_SAAT);
  }
  if (now > s.luput) { cache.remove("SESI_" + token); return { valid: false, error: "Sesi telah tamat tempoh. Sila log masuk semula." }; }
  if (requiredRole && s.role !== requiredRole) return { valid: false, error: "Capaian ditolak. Kebenaran tidak mencukupi." };
  return { valid: true, emel: s.emel, role: s.role };
}

function setupAdminPertama() {
  var EMEL_ADMIN         = "admin@smiaag.edu.my"; 
  var PASSWORD_SEMENTARA = "TukarSaya123";           

  var sheetUsers = pastikanTab("Users", ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar"]);
  pastikanTab("Sessions", ["Token", "Emel", "Role", "ExpiryTimestamp"]);
  pastikanTab("Log", ["Masa", "Emel", "Tindakan", "Status"]);

  var dataUsers = sheetUsers.getDataRange().getValues();
  for (var i = 1; i < dataUsers.length; i++) {
    if (dataUsers[i][0].toString().toLowerCase() === EMEL_ADMIN.toLowerCase()) return "Akaun Admin sudah wujud!";
  }

  var userSalt = Utilities.getUuid();
  var passHash = hashPassword(PASSWORD_SEMENTARA, userSalt);
  sheetUsers.appendRow([sanitizeFormula(EMEL_ADMIN.toLowerCase()), "Pentadbir Utama", "ADMIN", passHash, userSalt, true, "", "", "ACTIVE", new Date()]);

  logActivity(EMEL_ADMIN, "SETUP_ADMIN_PERTAMA", "SUCCESS");
  Logger.log("BERJAYA! Akaun Admin dicipta: " + EMEL_ADMIN);
  return "Berjaya mencipta Akaun Admin!";
}

function doGet(e) { return ContentService.createTextOutput(JSON.stringify({ status: "online" })).setMimeType(ContentService.MimeType.JSON); }

function jsonResponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function handleMintaKodReset(payload) {
  var emel = (payload.emel || "").trim().toLowerCase();
  var GENERIC_MSG = "Kalau emel ini berdaftar, kod telah dihantar."; 
  
  if (!emel) return jsonResponse({ success: true, message: GENERIC_MSG });

  var cache = CacheService.getScriptCache();
  var cacheKey = "RESET_REQ_" + emel;
  var reqCount = parseInt(cache.get(cacheKey) || "0", 10);
  if (reqCount >= 3) return jsonResponse({ success: true, message: GENERIC_MSG }); 
  cache.put(cacheKey, (reqCount + 1).toString(), 3600); 

  var sheetUsers = pastikanTab("Users", ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar"]);
  var data = sheetUsers.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === emel && data[i][8] === "ACTIVE") {
      if (ssoSahaja(data[i])) { logActivity(emel, "MINTA_KOD_RESET", "BLOCKED_SSO_ONLY"); break; } // masuk melalui Profil Guru sahaja
      var kodRawak = janaKodReset();
      var hashedKod = hashPassword(kodRawak, data[i][4]); 
      var luput = new Date().getTime() + (15 * 60 * 1000); 

      sheetUsers.getRange(i + 1, 7).setValue(hashedKod); 
      sheetUsers.getRange(i + 1, 8).setValue(luput);     
      
      try {
        MailApp.sendEmail(emel, "[e-Cuti] Kod Tetapan Semula Kata Laluan", 
          "Seseorang telah meminta untuk menetapkan semula kata laluan anda.\n\n" +
          "Kod 6-digit anda ialah: " + kodRawak + "\n\n" + 
          "Kod ini sah selama 15 minit. Jika anda tidak memintanya, abaikan emel ini."
        );
      } catch(e) {}
      logActivity(emel, "MINTA_KOD_RESET", "SENT");
      break; 
    }
  }
  return jsonResponse({ success: true, message: GENERIC_MSG });
}

function handleSahkanKodReset(payload) {
  var emel = (payload.emel || "").trim().toLowerCase();
  var kod = payload.kod || "";
  var newPassword = payload.newPassword || "";
  
  if (!emel || !kod || newPassword.length < PASSWORD_MIN) return jsonResponse({ success: false, message: "Maklumat tidak lengkap atau kata laluan terlalu pendek (minimum " + PASSWORD_MIN + " aksara)." });

  var cache = CacheService.getScriptCache();
  var attemptKey = "RESET_ATTEMPT_" + emel;
  var attempts = parseInt(cache.get(attemptKey) || "0", 10);
  
  if (attempts >= 5) return jsonResponse({ success: false, message: "Terlalu banyak percubaan gagal. Kod telah dibatalkan." });

  var sheetUsers = pastikanTab("Users", ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar"]);
  var data = sheetUsers.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === emel && data[i][8] === "ACTIVE") {
      var dbKodHash = data[i][6];
      var dbLuput = parseInt(data[i][7], 10);
      var now = new Date().getTime();

      if (!dbKodHash || now > dbLuput) {
        logActivity(emel, "SAHKAN_KOD_RESET", "EXPIRED_OR_EMPTY");
        return jsonResponse({ success: false, message: "Kod tidak sah atau telah tamat tempoh." });
      }

      var inputKodHash = hashPassword(kod, data[i][4]);
      if (inputKodHash === dbKodHash) {
        var newSalt = Utilities.getUuid();
        sheetUsers.getRange(i + 1, 4).setValue(hashPassword(newPassword, newSalt)); 
        sheetUsers.getRange(i + 1, 5).setValue(newSalt); 
        sheetUsers.getRange(i + 1, 6).setValue(false); 
        sheetUsers.getRange(i + 1, 7).setValue(""); 
        sheetUsers.getRange(i + 1, 8).setValue("");
        
        cache.remove(attemptKey);
        invalidateUserSessions(emel); 
        logActivity(emel, "TUKAR_PASSWORD_RESET", "SUCCESS");
        return jsonResponse({ success: true, message: "Kata laluan berjaya ditukar! Sila log masuk." });
      } else {
        attempts++;
        cache.put(attemptKey, attempts.toString(), 15 * 60); 
        if (attempts >= 5) {
          sheetUsers.getRange(i + 1, 7).setValue(""); 
          sheetUsers.getRange(i + 1, 8).setValue("");
          logActivity(emel, "SAHKAN_KOD_RESET", "LOCKED_MAX_ATTEMPTS");
          return jsonResponse({ success: false, message: "Terlalu banyak percubaan salah. Sila minta kod baharu." });
        }
        logActivity(emel, "SAHKAN_KOD_RESET", "WRONG_CODE");
        return jsonResponse({ success: false, message: "Kod salah. Baki percubaan: " + (5 - attempts) });
      }
    }
  }
  return jsonResponse({ success: false, message: "Ralat. Kod tidak sah." });
}

function handleGetUsers(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Capaian ditolak." });
  var data = pastikanTab("Users", ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar"]).getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    if(data[i][8] === "ACTIVE") users.push({ emel: data[i][0], nama: data[i][1], role: data[i][2], tarikhDaftar: data[i][9], ssoSahaja: ssoSahaja(data[i]) });
  }
  return jsonResponse({ success: true, data: users });
}

function handleDeleteUser(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Capaian ditolak." });
  var targetEmel = payload.emelTarget.toLowerCase();
  
  var sheetUsers = pastikanTab("Users", ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar"]);
  var data = sheetUsers.getDataRange().getValues();
  
  var totalAdmin = 0;
  var targetRow = -1;
  var targetRole = "";
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][8] === "ACTIVE" && data[i][2] === "ADMIN") totalAdmin++;
    if (data[i][0].toString().toLowerCase() === targetEmel && data[i][8] === "ACTIVE") { targetRow = i + 1; targetRole = data[i][2]; }
  }

  if (targetRow === -1) return jsonResponse({ success: false, message: "Pengguna tidak dijumpai." });
  if (targetRole === "ADMIN" && totalAdmin <= 1) {
    logActivity(sessionCheck.emel, "CUBA_PADAM_ADMIN_TERAKHIR", "BLOCKED");
    return jsonResponse({ success: false, message: "TINDAKAN DISEKAT: Anda tidak boleh memadam pentadbir tunggal yang terakhir di dalam sistem." });
  }

  sheetUsers.getRange(targetRow, 9).setValue("DELETED");
  invalidateUserSessions(targetEmel);
  logActivity(sessionCheck.emel, "PADAM_PENGGUNA", targetEmel);
  
  return jsonResponse({ success: true, message: "Pengguna berjaya dipadamkan." });
}

// ====================================================================
// HELPER TARIKH & PENGGUNA (BAHARU)
// ====================================================================
var TZ = "Asia/Kuala_Lumpur";
var MAX_GURU_SEHARI = 3;
var ROLE_SAH = ["ADMIN", "GURU", "STAF"];
var KATEGORI_SAH = ["Urusan Peribadi / Keluarga", "Kecemasan & Kesihatan", "Kursus / Bengkel", "Lain-Lain"];
var MIME_SAH = ["application/pdf", "image/png", "image/jpeg"];
// SsoSahaja = TRUE: akaun dicipta automatik daripada Profil Guru; tiada kata laluan e-Cuti, masuk melalui Profil Guru sahaja.
var HEADER_USERS = ["Emel", "Nama", "Role", "PasswordHash", "Salt", "MestiTukarPassword", "ResetKodHash", "ResetLuput", "Status", "TarikhDaftar", "SsoSahaja"];
function ssoSahaja(row) { return row[10] === true || String(row[10]).toUpperCase() === "TRUE"; }
var HEADER_SESSIONS = ["Token", "Emel", "Role", "ExpiryTimestamp"];
var HEADER_CUTI = ["ID", "NamaGuru", "Emel", "TarikhMohon", "TarikhMula", "TarikhAkhir", "JumlahHari", "SebabKategori", "SebabButiran", "Status", "JadualRelief", "NamaFailSurat", "UlasanPengetua"];

// Tukar nilai sel (Date atau teks) kepada "yyyy-MM-dd"
function toYMD(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, TZ, "yyyy-MM-dd");
  var s = val.toString().trim().replace(/^'/, "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.substring(0, 10) : s;
}

function isValidYMD(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.getUTCFullYear() === +p[0] && d.getUTCMonth() === +p[1] - 1 && d.getUTCDate() === +p[2];
}

function formatTarikhDMY(ymd) {
  var p = (ymd || "").split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ymd;
}

function cariPengguna(emel) {
  var sheet = pastikanTab("Users", HEADER_USERS);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().toLowerCase() === emel.toLowerCase() && data[i][8] === "ACTIVE") {
      return { sheet: sheet, row: i + 1, data: data[i] };
    }
  }
  return null;
}

// Senarai tarikh khas: TANPA_HAD (kuota dilepaskan) dan SABTU (Sabtu yang ada program = hari bekerja)
// CUTI = cuti umum / cuti sekolah (bukan hari persekolahan: tidak dikira sebagai hari cuti dan tidak boleh dimohon)
var TAB_TARIKH = { TANPA_HAD: "TarikhTanpaHad", SABTU: "SabtuProgram", CUTI: "CutiSekolah" };
var HEADER_TARIKH = { TANPA_HAD: ["Tarikh"], SABTU: ["Tarikh"], CUTI: ["Tarikh", "Nama"] };
function jenisTarikh(payload) { return payload.jenis === "SABTU" ? "SABTU" : (payload.jenis === "CUTI" ? "CUTI" : "TANPA_HAD"); }

// Kalendar Akademik 2027, Kumpulan B (termasuk Selangor), daripada pekeliling KPM (Lampiran B dan C).
// Diisi automatik SEKALI ke tab CutiSekolah. Cuti umum lain (contoh Hari Pekerja, Hari Kebangsaan, cuti negeri)
// TIADA dalam pekeliling itu dan ditambah oleh admin melalui Tetapan Tarikh Khas > Cuti Umum / Sekolah.
var CUTI_KPM_2027_B = [
  ["2027-02-05", "2027-02-05", "Tahun Baharu Cina (cuti tambahan KPM)"],
  ["2027-02-06", "2027-02-07", "Tahun Baharu Cina"],
  ["2027-02-09", "2027-02-12", "Tahun Baharu Cina (cuti tambahan KPM)"],
  ["2027-03-06", "2027-03-14", "Cuti Penggal 1"],
  ["2027-05-17", "2027-05-17", "Hari Raya Korban"],
  ["2027-05-18", "2027-05-19", "Hari Raya Korban (cuti tambahan KPM)"],
  ["2027-05-20", "2027-05-20", "Hari Wesak"],
  ["2027-05-21", "2027-05-21", "Hari Wesak (cuti tambahan KPM)"],
  ["2027-05-22", "2027-06-06", "Cuti Pertengahan Tahun"],
  ["2027-08-28", "2027-09-05", "Cuti Penggal 2"],
  ["2027-10-27", "2027-10-27", "Hari Deepavali (cuti tambahan KPM)"],
  ["2027-10-28", "2027-10-28", "Hari Deepavali"],
  ["2027-10-29", "2027-10-29", "Hari Deepavali (cuti tambahan KPM)"],
  ["2027-12-04", "2027-12-31", "Cuti Akhir Persekolahan"]
];

function julatKeTarikh(mula, akhir) {
  var a = mula.split("-"), b = akhir.split("-"), out = [];
  var cur = Date.UTC(+a[0], +a[1] - 1, +a[2]), end = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  while (cur <= end) { out.push(Utilities.formatDate(new Date(cur), "UTC", "yyyy-MM-dd")); cur += 86400000; }
  return out;
}

// Isi cuti KPM 2027 sekali sahaja (ditanda dalam Script Properties supaya tidak diisi semula jika admin memadamnya).
function isiCutiKpmSekali(sheet) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("CUTI_KPM_2027_B_DIISI")) return;
  var sedia = {};
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { var v = toYMD(data[i][0]); if (v) sedia[v] = true; }
  var baris = [];
  CUTI_KPM_2027_B.forEach(function(c) {
    julatKeTarikh(c[0], c[1]).forEach(function(d) { if (!sedia[d]) { sedia[d] = true; baris.push(["'" + d, c[2]]); } });
  });
  if (baris.length) sheet.getRange(sheet.getLastRow() + 1, 1, baris.length, 2).setValues(baris);
  props.setProperty("CUTI_KPM_2027_B_DIISI", new Date().toISOString());
}

// Senarai cuti umum/sekolah: [{ tarikh: "yyyy-MM-dd", nama }]
var _CUTI_MEMO = null; // sekali setiap larian; dikosongkan bila senarai diubah
function getCutiList() {
  if (_CUTI_MEMO) return _CUTI_MEMO;
  var sheet = pastikanTab(TAB_TARIKH.CUTI, HEADER_TARIKH.CUTI);
  isiCutiKpmSekali(sheet);
  var data = sheet.getDataRange().getValues(), out = [];
  for (var i = 1; i < data.length; i++) { var v = toYMD(data[i][0]); if (v) out.push({ tarikh: v, nama: (data[i][1] || "Cuti").toString() }); }
  _CUTI_MEMO = out;
  return out;
}
function getCutiTarikh() { return getCutiList().map(function(c) { return c.tarikh; }); }

function getTarikhList(jenis) {
  if (jenis === "CUTI") return getCutiTarikh();
  var data = pastikanTab(TAB_TARIKH[jenis], HEADER_TARIKH[jenis]).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) { var v = toYMD(data[i][0]); if (v) out.push(v); }
  return out;
}
function getTarikhTanpaHadList() { return getTarikhList("TANPA_HAD"); }

// Hari persekolahan antara dua tarikh: Isnin–Jumaat, + Sabtu yang ditanda program. Ahad sentiasa dikecualikan.
// Cuti umum/sekolah (tab CutiSekolah) dikecualikan, termasuk jika jatuh pada Sabtu program.
// Kira dalam UTC supaya tak lari zon masa.
function senaraiHariBekerja(mula, akhir, sabtuProgram, cuti) {
  sabtuProgram = sabtuProgram || [];
  var setCuti = {};
  (cuti === undefined ? getCutiTarikh() : cuti).forEach(function(d) { setCuti[d] = true; });
  var a = mula.split("-"), b = akhir.split("-");
  var cur = Date.UTC(+a[0], +a[1] - 1, +a[2]), end = Date.UTC(+b[0], +b[1] - 1, +b[2]);
  var out = [];
  while (cur <= end) {
    var d = new Date(cur), ymd = Utilities.formatDate(d, "UTC", "yyyy-MM-dd"), hari = d.getUTCDay();
    if (setCuti[ymd]) { /* cuti umum / cuti sekolah */ }
    else if (hari >= 1 && hari <= 5) out.push(ymd);
    else if (hari === 6 && sabtuProgram.indexOf(ymd) > -1) out.push(ymd);
    cur += 86400000;
  }
  return out;
}

// Kiraan penggunaan kuota sehari (APPROVED + PENDING)
function kiraPenggunaanKuota(dataCuti, sabtuProgram) {
  var usage = {}, cuti = getCutiTarikh();
  for (var i = 1; i < dataCuti.length; i++) {
    var st = dataCuti[i][9].toString();
    if (st !== "APPROVED" && st !== "PENDING") continue;
    var m = toYMD(dataCuti[i][4]), a = toYMD(dataCuti[i][5]);
    if (!isValidYMD(m) || !isValidYMD(a)) continue;
    senaraiHariBekerja(m, a, sabtuProgram, cuti).forEach(function(d) { usage[d] = (usage[d] || 0) + 1; });
  }
  return usage;
}

function handleGetUnlimitedDates() {
  return jsonResponse({ success: true, data: getTarikhList("TANPA_HAD"), sabtu: getTarikhList("SABTU"), cuti: getCutiList(), versi: SERVER_VERSI });
}

function handleAddUnlimitedDate(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Ditolak" });
  var jenis = jenisTarikh(payload);
  var dates = payload.dates || [];
  if (payload.date && dates.length === 0) dates = [payload.date];
  dates = dates.filter(isValidYMD);
  if (jenis === "SABTU") dates = dates.filter(function(d) { var p = d.split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() === 6; });
  if (dates.length === 0) return jsonResponse({ success: false, message: jenis === "SABTU" ? "Tiada hari Sabtu dalam pilihan." : "Tiada tarikh sah" });

  if (dates.length > 400) return jsonResponse({ success: false, message: "Julat terlalu panjang (maksimum 400 hari)." });
  var sedia = getTarikhList(jenis);
  var baru = dates.filter(function(d, idx) { return sedia.indexOf(d) === -1 && dates.indexOf(d) === idx; });
  if (baru.length > 0) {
    var sheet = pastikanTab(TAB_TARIKH[jenis], HEADER_TARIKH[jenis]);
    if (jenis === "CUTI") {
      var nama = sanitizeFormula((payload.nama || "").toString().trim().substring(0, 80)) || "Cuti tambahan";
      sheet.getRange(sheet.getLastRow() + 1, 1, baru.length, 2).setValues(baru.map(function(d) { return ["'" + d, nama]; }));
    } else {
      sheet.getRange(sheet.getLastRow() + 1, 1, baru.length, 1).setValues(baru.map(function(d) { return ["'" + d]; }));
    }
  }
  _CUTI_MEMO = null;
  logActivity(sessionCheck.emel, "TAMBAH_" + jenis, baru.length > 20 ? baru[0] + " .. " + baru[baru.length - 1] + " (" + baru.length + " hari)" : baru.join(","));
  return jsonResponse({ success: true, message: "Tarikh ditambah", added: baru });
}

function handleRemoveUnlimitedDate(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Ditolak" });
  var jenis = jenisTarikh(payload);
  var sheet = pastikanTab(TAB_TARIKH[jenis], HEADER_TARIKH[jenis]);
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (toYMD(data[i][0]) === payload.date) {
      sheet.deleteRow(i + 1);
      _CUTI_MEMO = null;
      logActivity(sessionCheck.emel, "BUANG_" + jenis, payload.date);
      return jsonResponse({ success: true, message: "Dibuang" });
    }
  }
  return jsonResponse({ success: false, message: "Tidak dijumpai" });
}

function bersihkanSesi(tapis) {
  var sheet = pastikanTab("Sessions", HEADER_SESSIONS);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  var simpan = [data[0]], dibuang = [];
  for (var i = 1; i < data.length; i++) { if (!tapis(data[i])) simpan.push(data[i]); else dibuang.push("SESI_" + data[i][0]); }
  if (simpan.length === data.length) return;
  CacheService.getScriptCache().removeAll(dibuang); // sesi yang dipadam tidak boleh terus hidup dalam cache
  sheet.getRange(1, 1, data.length, data[0].length).clearContent();
  sheet.getRange(1, 1, simpan.length, data[0].length).setValues(simpan);
}

function invalidateUserSessions(emel) {
  var e = emel.toLowerCase();
  bersihkanSesi(function(r) { return r[1].toString().toLowerCase() === e; });
}

function buangSesiTamat() {
  var now = new Date().getTime();
  bersihkanSesi(function(r) { return now > parseInt(r[3], 10); });
}

function uploadFileToDrive(base64Data, fileName, mimeType) {
  // Fail TIDAK dikongsi awam. Admin/pemilik buka melalui action GET_ATTACHMENT.
  var folderName = "eCuti_Surat_Permohonan";
  var folders = DriveApp.getFoldersByName(folderName);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
  return folder.createFile(blob).getId();
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return jsonResponse({ success: false, message: "Permintaan tidak sah." });
    var payload = JSON.parse(e.postData.contents);

    // 1. ACTION AWAM (tanpa token)
    if (payload.action === "LOGIN") return handleLogin(payload);
    if (payload.action === "SSO_LOGIN") return handleSsoLogin(payload);
    if (payload.action === "MINTA_KOD_RESET") return handleMintaKodReset(payload);
    if (payload.action === "SAHKAN_KOD_RESET") return handleSahkanKodReset(payload);
    if (payload.action === "GET_UNLIMITED_DATES") return handleGetUnlimitedDates();
    // Senarai cuti (nama guru + tarikh) TIDAK lagi boleh dibaca tanpa log masuk (laluan PUBLIC_GHOST ditutup v2.3).

    // 2. ACTION WAJIB TOKEN
    var sessionCheck = validateSession(payload.token);
    if (!sessionCheck.valid) return jsonResponse({ success: false, message: sessionCheck.error, forceLogout: true });

    if (payload.action === "LOGOUT") return handleLogout(payload);

    // Pengguna yang belum tukar kata laluan sementara hanya boleh tukar kata laluan
    if (sessionCheck.role === "PENDING_PW") {
      if (payload.action === "CHANGE_PASSWORD") return handleChangePassword(payload, sessionCheck);
      return jsonResponse({ success: false, mustChangePassword: true, message: "Sila tukar kata laluan sementara dahulu." });
    }

    switch (payload.action) {
      case "CHANGE_PASSWORD": return handleChangePassword(payload, sessionCheck);
      case "SUBMIT_LEAVE": return handleSubmitLeave(payload, sessionCheck);
      case "GET_LEAVE_APPLICATIONS": return handleGetLeaveApplications(payload, sessionCheck);
      case "GET_ATTACHMENT": return handleGetAttachment(payload, sessionCheck);
      case "APPROVE_LEAVE": return handleApproveLeave(payload, sessionCheck);
      case "ADD_UNLIMITED_DATE": return handleAddUnlimitedDate(payload, sessionCheck);
      case "REMOVE_UNLIMITED_DATE": return handleRemoveUnlimitedDate(payload, sessionCheck);
      case "GET_USERS": return handleGetUsers(payload, sessionCheck);
      case "ADD_USER": return handleAddUser(payload, sessionCheck);
      case "EDIT_USER": return handleEditUser(payload, sessionCheck);
      case "DELETE_USER": return handleDeleteUser(payload, sessionCheck);
      case "GET_DATA_GURU": return handleGetDataGuru(sessionCheck);
      default: return jsonResponse({ success: false, message: "Aksi tidak dikenali." });
    }
  } catch (err) { return jsonResponse({ success: false, message: "Ralat Pelayan: " + err.toString() }); }
}

function handleLogin(payload) {
  var emel = (payload.emel || "").trim().toLowerCase();
  var password = payload.password || "";
  if (!emel || !password) return jsonResponse({ success: false, message: "Sila isi maklumat penuh." });
  if (!checkRateLimit(emel)) {
    logActivity(emel, "LOGIN", "FAILED_RATELIMIT");
    return jsonResponse({ success: false, message: "Terlalu banyak percubaan. Sila tunggu 5 minit." });
  }

  var u = cariPengguna(emel);
  if (u && ssoSahaja(u.data)) {
    logActivity(emel, "LOGIN", "BLOCKED_SSO_ONLY");
    return jsonResponse({ success: false, message: "Akaun ini log masuk melalui Sistem Profil Guru (menu e-Cuti), bukan dengan kata laluan." });
  }
  if (u && u.data[3] && hashPassword(password, u.data[4]) === u.data[3]) {
    clearRateLimit(emel);
    buangSesiTamat();
    var mesti = (u.data[5] === true || u.data[5].toString().toUpperCase() === "TRUE");
    var token = Utilities.getUuid() + "-" + Utilities.getUuid();
    var roleSesi = mesti ? "PENDING_PW" : u.data[2];
    pastikanTab("Sessions", HEADER_SESSIONS).appendRow([token, emel, roleSesi, new Date().getTime() + (SESSION_TTL_HOURS * 60 * 60 * 1000)]);
    logActivity(emel, "LOGIN", "SUCCESS");
    return jsonResponse({ success: true, token: token, emel: emel, nama: u.data[1], role: u.data[2], mestiTukarPassword: mesti });
  }
  logActivity(emel, "LOGIN", "FAILED_WRONG_CREDENTIALS");
  return jsonResponse({ success: false, message: "Emel atau kata laluan tidak sah." });
}

// ====================================================================
// LOG MASUK SEKALI (SSO) DARIPADA SISTEM PROFIL GURU SMIAAG
// Profil Guru mengeluarkan tiket: base64url(JSON) + "." + base64url(HMAC-SHA256(bahagian1, ECUTI_SSO_SECRET)).
// Kunci ECUTI_SSO_SECRET disalin ke Script Properties projek ini (nilai SAMA dengan projek Profil Guru).
// Tiket sah 60 saat, sekali guna (nonce). Pengguna dipadankan mengikut EMEL; peranan ikut tab Users e-Cuti.
// ====================================================================
function b64urlKeTeks(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString("UTF-8");
}

function b64urlDariBytes(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ""); }

function samaMasaTetap(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function handleSsoLogin(payload) {
  var gagal = function(sebab, mesej, emel) {
    logActivity(emel || "-", "SSO_LOGIN", sebab);
    return jsonResponse({ success: false, message: mesej });
  };
  var rahsia = PropertiesService.getScriptProperties().getProperty("ECUTI_SSO_SECRET");
  if (!rahsia) return gagal("FAILED_NOT_CONFIGURED", "Log masuk melalui Profil Guru belum disediakan.");
  var tiket = String(payload.tiket || "");
  var bah = tiket.split(".");
  if (tiket.length > 4000 || bah.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(bah[0]) || !/^[A-Za-z0-9_-]+$/.test(bah[1])) {
    return gagal("FAILED_FORMAT", "Tiket log masuk tidak sah.");
  }
  var jangka = b64urlDariBytes(Utilities.computeHmacSha256Signature(bah[0], rahsia, Utilities.Charset.UTF_8));
  if (!samaMasaTetap(jangka, bah[1])) return gagal("FAILED_SIGNATURE", "Tiket log masuk tidak sah.");

  var d;
  try { d = JSON.parse(b64urlKeTeks(bah[0])); } catch (e) { return gagal("FAILED_FORMAT", "Tiket log masuk tidak sah."); }
  var kini = Math.floor(new Date().getTime() / 1000);
  if (!d || d.v !== 1 || d.iss !== "smiaag-profil" || d.aud !== "ecuti" || typeof d.exp !== "number" || typeof d.iat !== "number" || typeof d.n !== "string") {
    return gagal("FAILED_FORMAT", "Tiket log masuk tidak sah.");
  }
  if (d.exp < kini || d.iat > kini + 30 || d.exp - d.iat > 120) {
    return gagal("FAILED_EXPIRED", "Tiket log masuk telah tamat tempoh. Tekan e-Cuti sekali lagi dalam Profil Guru.", d.emel);
  }

  // Nonce sekali guna (dalam kunci supaya dua permintaan serentak tidak lepas kedua-duanya)
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return gagal("FAILED_BUSY", "Pelayan sibuk. Cuba lagi.");
  try {
    var cache = CacheService.getScriptCache(), kunci = "SSO_N_" + d.n;
    if (cache.get(kunci)) return gagal("FAILED_REPLAY", "Tiket log masuk sudah digunakan. Tekan e-Cuti sekali lagi dalam Profil Guru.", d.emel);
    cache.put(kunci, "1", 600);
  } finally { lock.releaseLock(); }

  var emel = String(d.emel || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emel) || emel.length > 254) return gagal("FAILED_FORMAT", "Tiket log masuk tidak sah.");
  var u = cariPengguna(emel);
  if (!u) {
    // Akaun dicipta automatik: sesiapa yang berdaftar (dengan emel) dalam Profil Guru terus mendapat akses e-Cuti sebagai GURU.
    var hasil = ciptaAkaunDariProfil(emel, d.nama);
    if (!hasil.ok) return gagal(hasil.sebab, hasil.mesej, emel);
    u = cariPengguna(emel);
  }

  buangSesiTamat();
  var token = Utilities.getUuid() + "-" + Utilities.getUuid();
  pastikanTab("Sessions", HEADER_SESSIONS).appendRow([token, emel, u.data[2], new Date().getTime() + (SESSION_TTL_HOURS * 60 * 60 * 1000)]);
  logActivity(emel, "SSO_LOGIN", "SUCCESS");
  // Pengguna sudah disahkan oleh Profil Guru: tidak dipaksa menukar kata laluan e-Cuti.
  return jsonResponse({ success: true, token: token, emel: emel, nama: u.data[1], role: u.data[2], mestiTukarPassword: false });
}

/**
 * Cipta akaun e-Cuti untuk guru yang datang dari Profil Guru buat kali pertama.
 * - Peranan sentiasa GURU (ADMIN hanya ditetapkan oleh admin e-Cuti).
 * - Tiada kata laluan (SsoSahaja): akses bergantung pada akaun Profil Guru yang aktif.
 * - Akaun yang pernah DIPADAM oleh admin e-Cuti tidak dicipta semula secara automatik.
 * - Baris DATA_GURU ditambah (kelayakan kosong, diisi admin) jika emel belum dipadankan.
 */
function ciptaAkaunDariProfil(emel, namaTiket) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, sebab: "FAILED_BUSY", mesej: "Pelayan sibuk. Cuba lagi." };
  try {
    var sheet = pastikanTab("Users", HEADER_USERS, true);
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString().toLowerCase() !== emel) continue;
      if (data[i][8] === "ACTIVE") return { ok: true }; // dicipta oleh permintaan serentak
      return { ok: false, sebab: "FAILED_DELETED", mesej: "Akaun e-Cuti anda telah dipadam oleh pentadbir e-Cuti. Hubungi pentadbir untuk mengaktifkannya semula." };
    }
    var nama = String(namaTiket || "").replace(/\s+/g, " ").trim().substring(0, 100) || emel;
    sheet.appendRow([sanitizeFormula(emel), sanitizeFormula(nama), "GURU", "", "", false, "", "", "ACTIVE", new Date(), true]);
    logActivity(emel, "AKAUN_AUTO_PROFIL_GURU", "CREATED");

    var peta = petaDataGuru(true);
    if (!peta.emelKeNama[emel]) {
      var kepala = peta.sheet.getRange(1, 1, 1, peta.sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
      var baris = kepala.map(function(h) { return h === "NAMA_GURU" ? sanitizeFormula(nama) : (h === "EMEL" ? sanitizeFormula(emel) : (h === "BIL_CUTI_TAHUNAN_BERBAKI" ? KELAYAKAN_LALAI : "")); });
      peta.sheet.appendRow(baris);
    }
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function handleLogout(payload) {
  var t = payload.token;
  bersihkanSesi(function(r) { return r[0] === t; });
  return jsonResponse({ success: true });
}

function handleChangePassword(payload, sessionCheck) {
  var newP = payload.newPassword || "", oldP = payload.oldPassword || "";
  if (newP.length < PASSWORD_MIN) return jsonResponse({ success: false, message: "Kata laluan baharu minimum " + PASSWORD_MIN + " aksara." });
  if (!checkRateLimit(sessionCheck.emel)) return jsonResponse({ success: false, message: "Terlalu banyak percubaan. Sila tunggu 5 minit." });

  var u = cariPengguna(sessionCheck.emel);
  if (!u) return jsonResponse({ success: false, message: "Ralat teknikal." });
  if (hashPassword(oldP, u.data[4]) !== u.data[3]) {
    logActivity(sessionCheck.emel, "TUKAR_PASSWORD", "FAILED_OLD_PASSWORD");
    return jsonResponse({ success: false, message: "Kata laluan semasa salah." });
  }
  if (newP === oldP) return jsonResponse({ success: false, message: "Kata laluan baharu mesti berbeza." });

  clearRateLimit(sessionCheck.emel);
  var newSalt = Utilities.getUuid();
  u.sheet.getRange(u.row, 4, 1, 3).setValues([[hashPassword(newP, newSalt), newSalt, false]]);
  invalidateUserSessions(sessionCheck.emel);
  logActivity(sessionCheck.emel, "TUKAR_PASSWORD", "SUCCESS");
  return jsonResponse({ success: true, message: "Kata laluan berjaya dikemaskini! Sila log masuk semula." });
}

function handleAddUser(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Capaian ditolak." });
  if (!payload.emel || !payload.nama || !payload.role) return jsonResponse({ success: false, message: "Sila isi semua maklumat." });

  var emelBaru = payload.emel.toLowerCase().trim();
  var role = payload.role.toString().toUpperCase().trim();
  if (ROLE_SAH.indexOf(role) === -1) return jsonResponse({ success: false, message: "Peranan tidak sah." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emelBaru)) return jsonResponse({ success: false, message: "Format emel tidak sah." });
  if (cariPengguna(emelBaru)) return jsonResponse({ success: false, message: "Emel ini telah wujud dalam sistem." });

  var sheetUsers = pastikanTab("Users", HEADER_USERS);
  var salt = Utilities.getUuid();
  var kataSementara = janaKataLaluanSementara(); // rawak bagi setiap pengguna (bukan satu kata laluan sama untuk semua)
  sheetUsers.appendRow([sanitizeFormula(emelBaru), sanitizeFormula(payload.nama), role, hashPassword(kataSementara, salt), salt, true, "", "", "ACTIVE", new Date()]);

  try {
    MailApp.sendEmail(emelBaru, "[e-Cuti] Akaun Portal SMIAAG Telah Dicipta",
      "Salam sejahtera,\n\nAkaun portal e-Cuti SMIAAG anda telah didaftarkan dengan peranan " + role + ".\n\n" +
      "ID Log Masuk: " + emelBaru + "\n" +
      "Kata Laluan Sementara: " + kataSementara + "\n\n" +
      "Sila log masuk ke portal dan ANDA DIWAJIBKAN menukar kata laluan pada log masuk pertama.\n\nTerima kasih."
    );
    var emelDihantar = true;
  } catch(e) { emelDihantar = false; }

  logActivity(sessionCheck.emel, "TAMBAH_PENGGUNA", emelBaru);
  // Kata laluan sementara dipulangkan SEKALI kepada admin sebagai sandaran jika emel tidak sampai.
  return jsonResponse({ success: true, tempPassword: kataSementara, emelDihantar: !!emelDihantar,
    message: emelDihantar ? "Pengguna ditambah dan kata laluan sementara dihantar ke emel." : "Pengguna ditambah, tetapi emel GAGAL dihantar. Serahkan kata laluan sementara secara terus." });
}

function handleEditUser(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Capaian ditolak." });

  var targetEmel = (payload.targetEmel || "").trim().toLowerCase();
  var newEmel = (payload.emel || "").trim().toLowerCase();
  var newNama = (payload.nama || "").trim();
  var newRole = (payload.role || "").trim().toUpperCase();

  if (!targetEmel || !newEmel || !newNama || !newRole) return jsonResponse({ success: false, message: "Sila lengkapkan semua maklumat." });
  if (ROLE_SAH.indexOf(newRole) === -1) return jsonResponse({ success: false, message: "Peranan tidak sah." });

  var sheetUsers = pastikanTab("Users", HEADER_USERS);
  var data = sheetUsers.getDataRange().getValues();
  var targetRow = -1, currentRole = "", totalAdmin = 0;

  for (var i = 1; i < data.length; i++) {
    if (data[i][8] === "ACTIVE" && data[i][2] === "ADMIN") totalAdmin++;
    if (data[i][8] === "ACTIVE" && data[i][0].toString().toLowerCase() === targetEmel) { targetRow = i + 1; currentRole = data[i][2]; }
  }
  if (targetRow === -1) return jsonResponse({ success: false, message: "Pengguna tidak dijumpai." });

  if (currentRole === "ADMIN" && newRole !== "ADMIN" && totalAdmin <= 1) {
    logActivity(sessionCheck.emel, "CUBA_UBAH_PERANAN_ADMIN_TERAKHIR", "BLOCKED");
    return jsonResponse({ success: false, message: "TINDAKAN DISEKAT: Anda tidak boleh mengubah peranan pentadbir tunggal yang terakhir di dalam sistem." });
  }
  if (newEmel !== targetEmel && cariPengguna(newEmel)) {
    return jsonResponse({ success: false, message: "Alamat emel baharu ini telah pun berdaftar di bawah pengguna lain." });
  }

  sheetUsers.getRange(targetRow, 1, 1, 3).setValues([[sanitizeFormula(newEmel), sanitizeFormula(newNama), newRole]]);

  // Emel ATAU peranan berubah: batalkan semua sesi supaya peranan lama tak kekal
  if (newEmel !== targetEmel || newRole !== currentRole) invalidateUserSessions(targetEmel);

  logActivity(sessionCheck.emel, "KEMASKINI_PENGGUNA", targetEmel + " -> " + newEmel + " (" + newRole + ")");
  return jsonResponse({ success: true, message: "Maklumat pengguna berjaya dikemaskini." });
}

// ---- Padanan guru antara DATA_GURU (kelayakan cuti), Users (akaun) dan PermohonanCuti ----
// Padanan utama ialah EMEL (lajur EMEL dalam DATA_GURU). Jika lajur itu kosong, guna nama yang sama dalam Users
// (abaikan huruf besar/kecil dan ruang berlebihan) selagi hanya SATU akaun aktif bernama begitu.
function normNama(v) { return String(v === null || v === undefined ? "" : v).replace(/\s+/g, " ").trim().toUpperCase(); }

var KELAYAKAN_LALAI = 12; // hari cuti tahunan setahun jika lajur BIL_CUTI_TAHUNAN_BERBAKI kosong; admin ubah angka dalam DATA_GURU

function petaDataGuru(semakSemula) {
  var sheet = pastikanTab("DATA_GURU", ["NAMA_GURU", "BIL_CUTI_TAHUNAN_BERBAKI", "EMEL"], semakSemula);
  var data = sheet.getDataRange().getValues();
  var kepala = data[0].map(function(h) { return String(h).trim(); });
  var iNama = kepala.indexOf("NAMA_GURU"), iBil = kepala.indexOf("BIL_CUTI_TAHUNAN_BERBAKI"), iEmel = kepala.indexOf("EMEL");
  var users = pastikanTab("Users", HEADER_USERS).getDataRange().getValues();
  var ikutNama = {};
  for (var u = 1; u < users.length; u++) {
    if (users[u][8] !== "ACTIVE") continue;
    var k = normNama(users[u][1]);
    (ikutNama[k] = ikutNama[k] || []).push(users[u][0].toString().toLowerCase());
  }
  var senarai = [], emelKeNama = {};
  for (var i = 1; i < data.length; i++) {
    if (!data[i][iNama]) continue;
    var nama = data[i][iNama].toString().trim();
    var emel = iEmel > -1 ? String(data[i][iEmel] || "").trim().toLowerCase() : "";
    var padan = emel ? "EMEL" : "";
    if (!emel) { var c = ikutNama[normNama(nama)] || []; if (c.length === 1) { emel = c[0]; padan = "NAMA"; } }
    if (emel && !emelKeNama[emel]) emelKeNama[emel] = nama;
    var bil = data[i][iBil];
    var kelayakan = (bil === "" || bil === null || bil === undefined) ? KELAYAKAN_LALAI : (parseInt(bil, 10) || 0); // 0 yang ditaip kekal 0
    senarai.push({ baris: i + 1, nama: nama, kelayakan: kelayakan, emel: emel, padan: padan });
  }
  return { sheet: sheet, lajurEmel: iEmel + 1, senarai: senarai, emelKeNama: emelKeNama };
}

function handleGetDataGuru(sessionCheck) {
  var peta = petaDataGuru();
  var isAdmin = sessionCheck.role === "ADMIN";
  var emelSendiri = (sessionCheck.emel || "").toLowerCase();
  var teachers = peta.senarai.map(function(g) {
    var sendiri = !!g.emel && g.emel === emelSendiri;
    // Bukan admin: nampak senarai nama (untuk jadual relief), kelayakan hanya milik sendiri
    var t = { NAMA_GURU: g.nama, BIL_CUTI_TAHUNAN_BERBAKI: (isAdmin || sendiri) ? g.kelayakan : null, SENDIRI: sendiri };
    if (isAdmin) { t.EMEL = g.emel; t.PADAN = g.padan; } // PADAN kosong = tiada akaun sepadan (isi lajur EMEL)
    return t;
  });
  return jsonResponse({ success: true, data: teachers });
}

/**
 * Jalankan SEKALI dari editor Apps Script: isi lajur EMEL dalam DATA_GURU daripada akaun Users yang namanya sama.
 * Baris yang tidak dapat dipadankan disenaraikan dalam log untuk diisi secara manual.
 */
function isiEmelDataGuru() {
  var peta = petaDataGuru(true), diisi = 0, tiada = [];
  peta.senarai.forEach(function(g) {
    if (g.padan === "NAMA") { peta.sheet.getRange(g.baris, peta.lajurEmel).setValue(sanitizeFormula(g.emel)); diisi++; }
    else if (!g.padan) tiada.push(g.nama);
  });
  var mesej = diisi + " emel diisi. " + (tiada.length ? "Tiada akaun sepadan (isi lajur EMEL sendiri): " + tiada.join("; ") : "Semua guru dipadankan.");
  Logger.log(mesej);
  return mesej;
}

function bacaLampiran(raw) {
  try { var o = JSON.parse(raw); if (o && o.fileId) return o; } catch(e) {}
  return null;
}

function handleGetLeaveApplications(payload, sessionCheck) {
  var data = pastikanTab("PermohonanCuti", HEADER_CUTI).getDataRange().getValues();
  var apps = [];
  var isAdmin = sessionCheck.role === "ADMIN";
  var userEmail = (sessionCheck.emel || "").toLowerCase();
  var emelKeNama = petaDataGuru().emelKeNama;

  for (var i = 1; i < data.length; i++) {
    var status = data[i][9].toString();
    var emelPemohon = data[i][2].toString().toLowerCase();
    var milikSendiri = userEmail && emelPemohon === userEmail;
    if (!(isAdmin || status === "APPROVED" || milikSendiri)) continue;

    var mohon = data[i][3], appTs = 0, appStr = "";
    if (mohon instanceof Date) { appTs = mohon.getTime(); appStr = Utilities.formatDate(mohon, TZ, "dd/MM/yyyy h.mma").toLowerCase(); }
    else { appStr = mohon.toString(); }

    var item = {
      id: data[i][0].toString(), teacherName: data[i][1].toString(),
      startDate: toYMD(data[i][4]), endDate: toYMD(data[i][5]), totalDays: parseInt(data[i][6], 10) || 0, status: status,
      guruData: emelKeNama[emelPemohon] || "" // nama dalam DATA_GURU, dipadankan ikut EMEL pemohon (untuk kiraan baki)
    };

    if (isAdmin || milikSendiri) {
      var lamp = bacaLampiran(data[i][11]);
      var relief = []; try { relief = JSON.parse(data[i][10]); } catch(e) {}
      item.teacherEmail = data[i][2].toString();
      item.appDate = appStr; item.appTs = appTs;
      item.reasonCategory = data[i][7]; item.reasonDetails = data[i][8];
      item.relief = relief; item.pengetuaNotes = data[i][12];
      item.attachmentName = lamp ? lamp.name : ""; item.hasAttachment = !!lamp;
    } else {
      // Rekod orang lain: nama & tarikh sahaja
      item.teacherEmail = ""; item.appDate = ""; item.appTs = 0;
      item.reasonCategory = "Sulit"; item.reasonDetails = ""; item.relief = [];
      item.pengetuaNotes = ""; item.attachmentName = ""; item.hasAttachment = false;
    }
    apps.push(item);
  }
  return jsonResponse({ success: true, data: apps, usage: kiraPenggunaanKuota(data, getTarikhList("SABTU")) });
}

function handleGetAttachment(payload, sessionCheck) {
  var data = pastikanTab("PermohonanCuti", HEADER_CUTI).getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString() !== payload.appId) continue;
    var milik = data[i][2].toString().toLowerCase() === sessionCheck.emel.toLowerCase();
    if (sessionCheck.role !== "ADMIN" && !milik) return jsonResponse({ success: false, message: "Capaian ditolak." });
    var lamp = bacaLampiran(data[i][11]);
    if (!lamp) return jsonResponse({ success: false, message: /"dipadam"/.test(String(data[i][11])) ? "Lampiran telah dipadam selepas tempoh simpanan " + TAHUN_SIMPAN + " tahun." : "Tiada lampiran." });
    var blob = DriveApp.getFileById(lamp.fileId).getBlob();
    logActivity(sessionCheck.emel, "LIHAT_LAMPIRAN", payload.appId);
    return jsonResponse({ success: true, name: lamp.name, mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) });
  }
  return jsonResponse({ success: false, message: "Permohonan tidak dijumpai." });
}

function handleSubmitLeave(payload, sessionCheck) {
  var app = payload.application || {};
  var u = cariPengguna(sessionCheck.emel);
  if (!u) return jsonResponse({ success: false, message: "Akaun tidak dijumpai." });

  var namaGuru = u.data[1].toString().trim();
  var emelGuru = sessionCheck.emel.toLowerCase();
  var mula = (app.startDate || "").toString(), akhir = (app.endDate || "").toString();
  var kategori = (app.reasonCategory || "").toString();
  var butiran = (app.reasonDetails || "").toString().trim().substring(0, 500);

  // --- Validasi asas ---
  if (!isValidYMD(mula) || !isValidYMD(akhir)) return jsonResponse({ success: false, message: "Format tarikh tidak sah." });
  if (akhir < mula) return jsonResponse({ success: false, message: "Tarikh akhir mesti selepas tarikh mula." });
  if (KATEGORI_SAH.indexOf(kategori) === -1) return jsonResponse({ success: false, message: "Kategori sebab tidak sah." });
  if (!butiran) return jsonResponse({ success: false, message: "Sila isi butiran lanjut." });

  var sabtuProgram = getTarikhList("SABTU");
  var hari = senaraiHariBekerja(mula, akhir, sabtuProgram);
  if (hari.length === 0) return jsonResponse({ success: false, message: "Tiada hari persekolahan dalam julat ini (Sabtu, Ahad dan cuti umum/sekolah tidak dikira, kecuali Sabtu yang ada program)." });
  if (hari.length > 60) return jsonResponse({ success: false, message: "Julat cuti terlalu panjang (maksimum 60 hari)." });

  if (!app.fileBase64) return jsonResponse({ success: false, message: "Lampiran surat rasmi adalah wajib." });
  if (MIME_SAH.indexOf(app.fileMimeType) === -1) return jsonResponse({ success: false, message: "Jenis fail mesti PDF, PNG atau JPG." });
  if (app.fileBase64.length > 7 * 1024 * 1024) return jsonResponse({ success: false, message: "Fail melebihi 5MB." });
  var namaFail = (app.fileName || "surat").toString().replace(/[\\\/:*?"<>|]/g, "_").substring(0, 120);

  var relief = (Array.isArray(app.relief) ? app.relief : []).slice(0, 30).map(function(r) {
    // Disimpan sebagai JSON (sel bermula dengan "["), jadi tiada risiko formula
    var bersih = function(v) { return (v || "").toString().substring(0, 100); };
    return { day: bersih(r.day), time: bersih(r.time), class: bersih(r.class), replacement: bersih(r.replacement) };
  });

  // --- Bahagian kritikal: kunci supaya dua permohonan serentak tak langgar kuota / ID ---
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return jsonResponse({ success: false, message: "Sistem sibuk. Sila cuba sebentar lagi." });
  try {
    var sheet = pastikanTab("PermohonanCuti", HEADER_CUTI);
    var data = sheet.getDataRange().getValues();

    // Tindihan dengan permohonan sendiri
    for (var i = 1; i < data.length; i++) {
      var st = data[i][9].toString();
      if (data[i][2].toString().toLowerCase() !== emelGuru || (st !== "PENDING" && st !== "APPROVED")) continue;
      var m = toYMD(data[i][4]), a = toYMD(data[i][5]);
      if (m <= akhir && a >= mula) return jsonResponse({ success: false, message: "Tarikh bertindih dengan permohonan anda " + data[i][0] + "." });
    }

    // Kuota harian (APPROVED + PENDING), kecuali tarikh tanpa had
    var usage = kiraPenggunaanKuota(data, sabtuProgram), tanpaHad = getTarikhTanpaHadList();
    var penuh = hari.filter(function(d) { return tanpaHad.indexOf(d) === -1 && (usage[d] || 0) >= MAX_GURU_SEHARI; });
    if (penuh.length > 0) {
      return jsonResponse({ success: false, message: "Kuota penuh pada: " + penuh.map(formatTarikhDMY).join(", ") + ". Sila pilih tarikh lain." });
    }

    // ID unik: CT-TAHUN-nnn (nombor terbesar tahun ini + 1)
    var tahun = new Date().getFullYear(), prefix = "CT-" + tahun + "-", maks = 0;
    for (var j = 1; j < data.length; j++) {
      var id = data[j][0].toString();
      if (id.indexOf(prefix) === 0) maks = Math.max(maks, parseInt(id.substring(prefix.length), 10) || 0);
    }
    var newId = prefix + ("00" + (maks + 1)).slice(-3);

    var fileId;
    try { fileId = uploadFileToDrive(app.fileBase64, namaFail, app.fileMimeType); }
    catch (e) { return jsonResponse({ success: false, message: "Gagal memuat naik fail. Sila cuba lagi." }); }

    sheet.appendRow([newId, sanitizeFormula(namaGuru), sanitizeFormula(emelGuru), new Date(), mula, akhir, hari.length,
      kategori, sanitizeFormula(butiran), "PENDING", JSON.stringify(relief),
      JSON.stringify({ name: namaFail, fileId: fileId }), ""]);
    SpreadsheetApp.flush();
    logActivity(emelGuru, "MOHON_CUTI", newId);
    return jsonResponse({ success: true, message: "Permohonan berjaya!", id: newId });
  } finally {
    lock.releaseLock();
  }
}

function handleApproveLeave(payload, sessionCheck) {
  if (sessionCheck.role !== "ADMIN") return jsonResponse({ success: false, message: "Hanya admin boleh meluluskan cuti." });
  if (payload.newStatus !== "APPROVED" && payload.newStatus !== "REJECTED") return jsonResponse({ success: false, message: "Status tidak sah." });

  var sheet = pastikanTab("PermohonanCuti", HEADER_CUTI);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString() !== payload.appId) continue;
    if (data[i][9].toString() !== "PENDING") return jsonResponse({ success: false, message: "Permohonan ini telah diproses sebelum ini." });

    var catatan = (payload.notes || "").toString().substring(0, 500);
    sheet.getRange(i + 1, 10).setValue(payload.newStatus);
    sheet.getRange(i + 1, 13).setValue(sanitizeFormula(catatan));
    logActivity(sessionCheck.emel, "PROSES_CUTI_" + payload.newStatus, payload.appId);

    var emelGuru = data[i][2].toString();
    if (emelGuru.indexOf("@") > -1) {
      var lulus = payload.newStatus === "APPROVED";
      var body = "Salam sejahtera " + data[i][1] + ",\n\n" +
                 "Permohonan cuti tahunan anda (" + payload.appId + ") dari " + formatTarikhDMY(toYMD(data[i][4])) + " hingga " + formatTarikhDMY(toYMD(data[i][5])) + " telah disemak oleh Pengetua.\n\n" +
                 "STATUS KELULUSAN : " + (lulus ? "DILULUSKAN" : "DITOLAK") + "\n" +
                 "CATATAN PENTADBIR : " + (catatan || "Tiada catatan tambahan.") + "\n\n" +
                 "Sila ambil maklum dan uruskan tugas serta jadual relief anda (jika berkaitan).\n\nTerima kasih.\n\nSistem e-Cuti SMIAAG";
      try { MailApp.sendEmail(emelGuru, "Status Permohonan Cuti e-Cuti SMIAAG: " + (lulus ? "DILULUSKAN" : "DITOLAK"), body); } catch(e) {}
    }
    return jsonResponse({ success: true, message: "Status dikemaskini & emel dihantar." });
  }
  return jsonResponse({ success: false, message: "Permohonan tidak dijumpai." });
}

// ====================================================================
// PENYELENGGARAAN MINGGUAN: tempoh simpanan (PDPA) dan sandaran
// Jalankan pasangPencetus() SEKALI dari editor Apps Script. Selepas itu selenggaraMingguan berjalan setiap Ahad 3 pagi.
// ====================================================================
var TAHUN_SIMPAN = 2;          // lampiran dan log aktiviti disimpan 2 tahun
var SANDARAN_BILANGAN = 4;     // bilangan salinan sandaran yang disimpan (bergilir)
var SANDARAN_TANPA = ["Sessions"]; // token log masuk tidak disalin

function pasangPencetus() {
  var ada = ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === "selenggaraMingguan"; });
  if (!ada) ScriptApp.newTrigger("selenggaraMingguan").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  var mesej = "Pencetus selenggaraMingguan (Ahad 3 pagi) " + (ada ? "sudah wujud." : "dipasang.");
  Logger.log(mesej);
  return mesej;
}

function selenggaraMingguan() {
  var hasil = [];
  try { hasil.push(bersihkanLampiranLama()); } catch (e) { hasil.push("Lampiran: RALAT " + e); }
  try { hasil.push(bersihkanLogLama()); } catch (e) { hasil.push("Log: RALAT " + e); }
  try { hasil.push(sandaranEcuti()); } catch (e) { hasil.push("Sandaran: RALAT " + e); }
  Logger.log(hasil.join("\n"));
  return hasil;
}

function tarikhHadSimpan() {
  var d = new Date();
  d.setFullYear(d.getFullYear() - TAHUN_SIMPAN);
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd");
}

// Lampiran (surat, MC) dibuang ke Trash Drive 2 tahun selepas tarikh akhir cuti. Rekod permohonan kekal.
function bersihkanLampiranLama() {
  var had = tarikhHadSimpan();
  var sheet = pastikanTab("PermohonanCuti", HEADER_CUTI);
  var data = sheet.getDataRange().getValues(), n = 0;
  for (var i = 1; i < data.length; i++) {
    var lamp = bacaLampiran(data[i][11]), akhir = toYMD(data[i][5]);
    if (!lamp || !isValidYMD(akhir) || akhir >= had) continue;
    try { DriveApp.getFileById(lamp.fileId).setTrashed(true); } catch (e) { /* fail sudah tiada */ }
    sheet.getRange(i + 1, 12).setValue(JSON.stringify({ name: lamp.name, dipadam: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd") }));
    n++;
  }
  if (n) logActivity("sistem", "PADAM_LAMPIRAN_LAMA", n + " fail");
  return "Lampiran: " + n + " fail melebihi " + TAHUN_SIMPAN + " tahun dipadam.";
}

// Log aktiviti melebihi 2 tahun dibuang (baris lama berada di atas).
function bersihkanLogLama() {
  var had = new Date(); had.setFullYear(had.getFullYear() - TAHUN_SIMPAN);
  var sheet = pastikanTab("Log", ["Masa", "Emel", "Tindakan", "Status"]);
  var data = sheet.getDataRange().getValues(), n = 0;
  for (var i = 1; i < data.length; i++) {
    var m = data[i][0], t = (m instanceof Date) ? m.getTime() : Date.parse(m);
    if (!(t < had.getTime())) break;
    n++;
  }
  for (var k = 0; k < n; k++) sheet.deleteRow(2);
  return "Log: " + n + " baris melebihi " + TAHUN_SIMPAN + " tahun dibuang.";
}

// Sandaran ke Spreadsheet berasingan dalam Drive pemilik skrip; 4 salinan terakhir, yang paling lama ditulis semula.
// Fail sandaran mengandungi data pengguna dan hash kata laluan: JANGAN kongsi.
function sandaranEcuti() {
  var props = PropertiesService.getScriptProperties(), ids = [];
  try { ids = JSON.parse(props.getProperty("SANDARAN_IDS") || "[]"); } catch (e) { ids = []; }
  var sumber = bukaSpreadsheet();
  var nama = "SANDARAN e-Cuti SMIAAG " + Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH.mm");
  var sasaran = null, id = null;
  if (ids.length >= SANDARAN_BILANGAN) {
    id = ids.pop();
    try { sasaran = SpreadsheetApp.openById(id); sasaran.rename(nama); } catch (e) { sasaran = null; }
  }
  if (!sasaran) { sasaran = SpreadsheetApp.create(nama); id = sasaran.getId(); }
  var lama = sasaran.getSheets(), bil = 0;
  sumber.getSheets().forEach(function(sh) {
    var n = sh.getName();
    if (SANDARAN_TANPA.indexOf(n) !== -1) return;
    var r = sh.getLastRow(), c = sh.getLastColumn();
    var t = sasaran.insertSheet("~" + n);
    if (r > 0 && c > 0) {
      t.getRange(1, 1, r, c).setValues(sh.getRange(1, 1, r, c).getValues().map(function(row) {
        return row.map(function(v) { return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v; }); // jangan jadi formula dalam sandaran
      }));
    }
    bil++;
  });
  lama.forEach(function(x) { sasaran.deleteSheet(x); });
  sasaran.getSheets().forEach(function(x) { x.setName(x.getName().replace(/^~/, "")); });
  ids.unshift(id);
  props.setProperty("SANDARAN_IDS", JSON.stringify(ids.slice(0, SANDARAN_BILANGAN)));
  return "Sandaran: \"" + nama + "\" (" + bil + " tab).";
}

