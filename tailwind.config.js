// Tailwind CSS (compilado): reemplaza a cdn.tailwindcss.com, que compilaba en el navegador en cada visita.
// Regenerar tras cambiar clases en index.html:  npm run build:css   (genera /tailwind.css, que se sube al repo)
// Los colores son los mismos que tenía el bloque tailwind.config de index.html.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        brandGreen: '#00A859',
        brandDarkGreen: '#1B4D3E',
        brandCream: '#FDFBF7',
        brandCardBg: '#F5F0E6',
        brandBeige: '#EBE3D5',
        brandGold: '#C5A059',
        brandTextDark: '#2B2621',
      },
    },
  },
  plugins: [],
};
