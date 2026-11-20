// Genera las plantillas HTML de Supabase Auth con el mismo diseño que los correos de Resend.
//   node scripts/build-email-templates.js   (o: npm run build:emails)
// Salida: supabase/email-templates/*.html  → copiar y pegar en Supabase → Authentication → Emails → Templates.
// Variables de Supabase que se conservan tal cual: {{ .ConfirmationURL }} y {{ .Email }}.
const fs = require('fs');
const path = require('path');
const { emailShell, button, fallbackLink, divider, C, FONT } = require('../api/_lib/email-layout');

const URL_VAR = '{{ .ConfirmationURL }}';
const EMAIL_VAR = '{{ .Email }}';
const h1 = (t) => `<h1 style="margin:0 0 10px;font-family:${FONT};font-size:24px;line-height:30px;font-weight:800;color:${C.ink}">${t}</h1>`;
const p = (t, extra = '') => `<p style="margin:0 0 12px;${extra}">${t}</p>`;
const small = (t) => `<p style="margin:0;font-size:13px;line-height:19px;color:${C.muted}">${t}</p>`;
const esHead = (t) => `<p style="margin:0 0 8px;font-size:12px;line-height:16px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:${C.gold}">${t}</p>`;
const notice = (t) => `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:14px 0 0"><tr>
  <td bgcolor="#FFF8E8" style="background:#FFF8E8;border-left:4px solid ${C.gold};border-radius:8px;padding:11px 14px;font-size:13px;line-height:19px;color:${C.text}">${t}</td></tr></table>`;

const templates = {
  'confirm-signup.html': {
    subject: 'Confirm your Barkwalk USA account · Confirma tu cuenta',
    html: emailShell({
      title: 'Confirm your Barkwalk USA account',
      preheader: 'One tap to activate your account · Un toque para activar tu cuenta',
      bodyHtml: [
        h1('Welcome to Barkwalk USA! 🐾'),
        p(`Thanks for signing up with <strong>${EMAIL_VAR}</strong>. Confirm your email to activate your account and start booking certified dog walkers in Birmingham.`),
        button(URL_VAR, 'Confirm my email'),
        small('This link can only be used once. If you didn’t create a Barkwalk account, you can safely ignore this email.'),
        divider(),
        esHead('Español'),
        p('<strong>¡Bienvenido a Barkwalk USA!</strong> Confirma tu correo para activar tu cuenta y empezar a reservar paseadores certificados en Birmingham.'),
        button(URL_VAR, 'Confirmar mi correo'),
        small('Este enlace solo se puede usar una vez. Si no creaste una cuenta en Barkwalk, puedes ignorar este correo.'),
        fallbackLink(URL_VAR, 'Button not working? Copy and paste this link · ¿El botón no funciona? Copia y pega este enlace:'),
      ].join('\n'),
    }),
  },
  'reset-password.html': {
    subject: 'Reset your Barkwalk USA password · Restablece tu contraseña',
    html: emailShell({
      title: 'Reset your Barkwalk USA password',
      preheader: 'Create a new password for your account · Crea una contraseña nueva',
      bodyHtml: [
        h1('Reset your password 🔑'),
        p(`We received a request to reset the password for <strong>${EMAIL_VAR}</strong>. Tap the button to choose a new one.`),
        button(URL_VAR, 'Choose a new password'),
        notice('For your security this link expires soon and works only once. If you didn’t request it, ignore this email — your password stays the same.'),
        divider(),
        esHead('Español'),
        p('<strong>Restablece tu contraseña.</strong> Recibimos una solicitud para cambiar la contraseña de tu cuenta. Toca el botón para elegir una nueva.'),
        button(URL_VAR, 'Elegir una contraseña nueva'),
        notice('Por tu seguridad, este enlace vence pronto y solo funciona una vez. Si no lo pediste, ignora este correo: tu contraseña no cambia.'),
        fallbackLink(URL_VAR, 'Button not working? Copy and paste this link · ¿El botón no funciona? Copia y pega este enlace:'),
      ].join('\n'),
    }),
  },
};

const outDir = path.join(__dirname, '..', 'supabase', 'email-templates');
fs.mkdirSync(outDir, { recursive: true });
const readme = ['# Plantillas de Supabase Auth (generadas)', '', 'Generadas por `npm run build:emails` desde `api/_lib/email-layout.js`. No las edites a mano: cambia el script y regenera.', '',
  'Pegar en Supabase → Authentication → Emails → Templates:', ''];
for (const [file, { subject, html }] of Object.entries(templates)) {
  if (!html.includes(URL_VAR)) throw new Error(`${file}: falta ${URL_VAR}`);
  fs.writeFileSync(path.join(outDir, file), html);
  readme.push(`- \`${file}\` → plantilla "${file.startsWith('confirm') ? 'Confirm signup' : 'Reset password'}" · Subject: **${subject}**`);
  console.log(`${file}: ${Buffer.byteLength(html)} bytes · subject: ${subject}`);
}
fs.writeFileSync(path.join(outDir, 'README.md'), readme.join('\n') + '\n');
