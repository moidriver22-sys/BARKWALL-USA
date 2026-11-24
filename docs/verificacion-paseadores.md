# Verificación de paseadores: estado actual y dónde conectar un proveedor externo

## Qué hace Barkwalk hoy (y qué dice la app)

| Paso | Qué ocurre | Dónde vive |
|---|---|---|
| 1. Registro | Nombre, correo, fecha de nacimiento (19+) y aceptación del Acuerdo para Paseadores, con constancia en `legal_consents` | `api/signup.js`, `api/_lib/terms.js` |
| 2. Términos vigentes | El paseador no ve ni acepta paseos sin la versión vigente aceptada | `public.bw_is_verified_walker()` → `private.bw_has_current_consent()` |
| 2b. Identidad | Foto del ID oficial **vigente** (licencia o State ID) + selfie + fecha de vencimiento, en el bucket **privado** `walker-docs` (solo el dueño y el admin, URLs firmadas de 2 min, sin borrar ni sobrescribir) | `walker-application.js`, `api/_lib/walker-identity.js`, `public.walker_applications` |
| 2c. Agente auditor | Analiza cada envío (consentimientos, edad, ID + selfie, vencimiento, coherencia, historial, Stripe) y deja un reporte en el panel. **Nunca aprueba** | `api/_lib/application-agent.js`, `/api/dispatch?action=application_audit` |
| 3. Revisión manual | El admin revisa la postulación y decide: aprobar, no aprobar (con motivo obligatorio) o suspender | `public.admin_set_walker_status(target_id, new_status, reason)` y `public.walker_reviews` |
| 4. Aviso | El paseador recibe correo y push con la decisión y el motivo | `api/_lib/walker-reviews.js`, `/api/dispatch?action=walker_reviews` |
| 5. Cobros | Stripe Connect Express verifica identidad y cuenta bancaria (KYC de Stripe) | `api/create-connect-account.js` |

Una persona del equipo **compara visualmente** el ID con la selfie (no hay reconocimiento facial). **Barkwalk NO realiza hoy verificaciones de antecedentes con proveedores externos.** Los textos de la web, los términos (versión 2026-11-24) y el asistente de IA lo dicen así. Hay una prueba (`tests/terms-gate.test.js`) que falla si vuelve a aparecer una afirmación como "background-checked", "certified" o "verificación de antecedentes" sin la aclaración.

## Cómo conectar un proveedor externo (por ejemplo, Checkr) en el futuro

Sin funciones nuevas en `api/` (límite de 12 del plan Hobby):

1. **Consentimiento FCRA por separado.** Hay que añadir un documento de divulgación y autorización (FCRA §604(b)(2)) que no forme parte de los términos, con su propia casilla y su constancia en `legal_consents` (por ejemplo, una columna `background_consent_version`).
2. **Datos:** una tabla `walker_background_checks` (aparte de `walker_applications`, que guarda la identidad) con `walker_id`, `provider`, `external_id`, `status` (`pending`, `clear`, `consider` o `suspended`), `completed_at` y `report_url`, con RLS para que solo la lean el admin y el propio paseador.
3. **Iniciar la verificación:** cuando el admin pulse "Iniciar verificación", una acción en `api/dispatch.js` llamaría a una librería nueva, `api/_lib/background-check.js`, que crea al candidato y la invitación en el proveedor.
4. **Resultado:** el webhook del proveedor llegaría como acción nueva de `api/dispatch.js` (`?action=background_webhook`, con verificación de firma) y actualizaría `walker_background_checks`.
5. **Regla de aprobación:** `admin_set_walker_status(..., 'verified')` exigiría `status = 'clear'`. Si el resultado es `consider`, hay que seguir el proceso de **adverse action** de la FCRA: aviso previo, copia del reporte, plazo para responder y aviso final. Para eso se reutiliza `walker_reviews` con el motivo.
6. **Textos:** solo cuando todo esto esté activo se puede volver a decir "con verificación de antecedentes". Hay que actualizar `index.html` (FAQ y "Acerca de"), `api/chat.js` (prompt del sistema), los términos (subiendo su versión) y la prueba de textos.
