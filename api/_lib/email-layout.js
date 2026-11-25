// Diseño común de los correos de Barkwalk USA (Resend y plantillas de Supabase Auth)
// ---------------------------------------------------------------------------
// · Maquetado con <table> y estilos inline: Gmail (web/Android/iOS), Apple Mail y Outlook.com ignoran <style>,
//   flex/grid y muchas propiedades modernas. Ancho máximo 560 px, se adapta al teléfono.
// · Logo PNG público y estable: https://www.barkwalkusa.com/email-logo.png (192×192, mostrado a 56 px).
//   Es una copia dedicada del icono de la app: NO lo renombres ni lo borres, los correos ya enviados lo usan.
// · Si el cliente bloquea imágenes, el nombre "BARKWALK USA" sigue visible como texto.
// · Las plantillas de Supabase se generan con scripts/build-email-templates.js desde este mismo archivo.
// ---------------------------------------------------------------------------
const SITE = 'https://www.barkwalkusa.com';
const LOGO_URL = `${SITE}/email-logo.png`;
const SUPPORT = 'barkwalkusallc@gmail.com';
// Datos legales (pie de todos los correos · CAN-SPAM: dirección postal física del remitente)
const LEGAL_NAME = 'Barkwalk USA LLC';
const LEGAL_ADDRESS = '900 Beacon Crest Circle 917, Birmingham, AL 35209';
const COPYRIGHT = '© 2026 Barkwalk USA LLC. All rights reserved.';

// Colores de marca (los mismos que index.html / tailwind.config.js)
const C = {
  header: '#14402F', ink: '#1B4D3E', green: '#00A859', gold: '#C5A059',
  page: '#F5F0E6', card: '#FFFFFF', line: '#EBE3D5', text: '#2B2621', muted: '#6B655D', soft: '#FAF7F1',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Botón "a prueba de balas": celda con color de fondo (funciona aunque el cliente quite estilos del <a>)
function button(href, label) {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;border-collapse:separate">
  <tr><td align="center" bgcolor="${C.ink}" style="border-radius:12px;background:${C.ink}">
    <a href="${href}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:16px;font-weight:700;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:12px">${label}</a>
  </td></tr></table>`;
}

// Enlace de respaldo por si el botón no funciona (se puede copiar y pegar)
function fallbackLink(href, intro) {
  return `<p style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">${intro}<br>
  <a href="${href}" style="color:${C.ink};word-break:break-all;text-decoration:underline">${href}</a></p>`;
}

function divider() {
  return `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding:22px 0"><div style="height:1px;line-height:1px;font-size:1px;background:${C.line}">&nbsp;</div></td></tr></table>`;
}

// Esqueleto del correo. bodyHtml es HTML ya preparado (puede incluir variables {{ .X }} de Supabase).
function emailShell({ title, preheader = '', bodyHtml, lang = 'en', footerNote = '' }) {
  return `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;width:100%;background:${C.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page}">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;border-collapse:separate">
    <!-- Cabecera con logo -->
    <tr><td bgcolor="${C.header}" style="background:${C.header};border-radius:20px 20px 0 0;padding:22px 24px">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;padding-right:14px">
          <a href="${SITE}" target="_blank" style="text-decoration:none"><img src="${LOGO_URL}" width="56" height="56" alt="Barkwalk USA" style="display:block;width:56px;height:56px;border:0;border-radius:14px;outline:none;text-decoration:none"></a>
        </td>
        <td style="vertical-align:middle;font-family:${FONT}">
          <div style="font-size:20px;line-height:22px;font-weight:900;letter-spacing:3px;color:#FFFFFF">BARKWALK</div>
          <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:5px;color:${C.gold}">USA</div>
        </td>
      </tr></table>
    </td></tr>
    <!-- Línea dorada -->
    <tr><td height="4" bgcolor="${C.gold}" style="background:${C.gold};height:4px;line-height:4px;font-size:4px">&nbsp;</td></tr>
    <!-- Contenido -->
    <tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:0 0 20px 20px;padding:30px 28px 28px;font-family:${FONT};font-size:15px;line-height:23px;color:${C.text}">
      ${bodyHtml}
    </td></tr>
    <!-- Pie -->
    <tr><td align="center" style="padding:20px 16px 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">
      ${footerNote ? `<p style="margin:0 0 10px">${footerNote}</p>` : ''}
      <p style="margin:0 0 6px"><strong style="color:${C.ink}">${LEGAL_NAME}</strong> · ${LEGAL_ADDRESS}</p>
      <p style="margin:0 0 6px">
        <a href="${SITE}" target="_blank" style="color:${C.ink};text-decoration:underline">barkwalkusa.com</a> ·
        <a href="mailto:${SUPPORT}" style="color:${C.ink};text-decoration:underline">${SUPPORT}</a>
      </p>
      <p style="margin:0">
        <a href="${SITE}/terminos-clientes" target="_blank" style="color:${C.muted};text-decoration:underline">Terms / Términos</a> ·
        <a href="${SITE}/privacidad" target="_blank" style="color:${C.muted};text-decoration:underline">Privacy / Privacidad</a>
      </p>
      <p style="margin:8px 0 0">${COPYRIGHT}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

module.exports = { emailShell, button, fallbackLink, divider, esc, C, FONT, SITE, LOGO_URL, SUPPORT, LEGAL_NAME, LEGAL_ADDRESS, COPYRIGHT };
