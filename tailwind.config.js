// Konfigurasi Tailwind (sama seperti konfigurasi sebaris yang digunakan semasa CDN).
// Bina semula CSS selepas mengubah kelas dalam public/index.html: npm run css
module.exports = {
  content: ['./public/index.html'],
  darkMode: 'class',
  theme: { extend: { fontFamily: { sans: ['"Plus Jakarta Sans"', 'sans-serif'] } } }
};
