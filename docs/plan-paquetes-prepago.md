# Plan: paquetes prepago de paseos (4 y 8)

Estado: **listo para implementar** después de la prueba real de punta a punta.
Restricción: **sin archivos nuevos en `api/`** (plan Hobby de Vercel, 12 funciones).

## 1. Producto

| Paquete | Descuento | Vigencia | Ejemplo con Paseo Estándar 30 min ($24) |
|---|---|---|---|
| 4 paseos | −5 % | 90 días desde la compra | 4 × $24 = $96 → **$91.20** ($22.80 por paseo) |
| 8 paseos | −10 % | 90 días desde la compra | 8 × $24 = $192 → **$172.80** ($21.60 por paseo) |

Reglas:
- **Cada paquete corresponde a un servicio y una duración concretos** (por ejemplo, Paseo Estándar 30 min). Un crédito equivale a 1 día de ese servicio para 1 mascota.
- **Extras** (baño, uñas, perro grande, mascota adicional): no los cubre el crédito y se cobran aparte con tarjeta en la misma reserva.
- **No se suma al Barkwalk Club.** Si el cliente es socio, el paquete se cotiza con el mayor de los dos descuentos: 10 % del Club o 5/10 % del paquete. Hoy el Club (10 %) siempre gana o empata, así que para un socio el paquete solo aporta comodidad. Se muestra con claridad antes de comprar: "Como socio del Club ya tienes 10 %".
- **El paseador cobra sobre el precio de lista.** Su ganancia neta (75 % estándar u 80 % Pro) se calcula sobre $24, nunca sobre $22.80 o $21.60. Barkwalk absorbe el descuento, igual que con el Club.
- **Créditos vencidos:** no se reembolsan. Se avisa 7 días antes del vencimiento (push y correo, Agente de Fidelización).
- **Reembolso de un paquete:** se devuelve la parte proporcional de los créditos **sin usar** (precio pagado por crédito × créditos sin usar), a solicitud del cliente.
- **Contracargo (disputa) sobre la compra del paquete:** los créditos restantes quedan bloqueados hasta que se resuelva.

## 2. Datos (migración `20261201_prepaid_packs.sql`)

```sql
create table public.walk_packs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  checkout_id uuid not null,                    -- idempotencia (como bookings)
  service_id text not null, variant_idx int not null, variant_label text not null,
  size int not null check (size in (4, 8)),
  discount_pct int not null check (discount_pct in (5, 10)),
  unit_list_cents int not null,                 -- precio de lista por crédito (base del pago al paseador)
  unit_paid_cents int not null,                 -- lo que pagó el cliente por crédito
  total_cents int not null,
  credits_used int not null default 0 check (credits_used between 0 and size),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','active','expired','refunded','blocked')),
  stripe_payment_intent_id text unique, paid_at timestamptz, expires_at timestamptz,
  refunded_cents int not null default 0, created_at timestamptz not null default now(),
  unique (client_id, checkout_id)
);
-- RLS: SELECT solo el dueño (client_id = auth.uid()) y admin. Sin escritura desde el navegador.

alter table public.bookings add column pack_id uuid references public.walk_packs(id),
                           add column pack_credits int not null default 0;
```

Función atómica para consumir créditos, de modo que un mismo crédito no se use dos veces:
```sql
-- service_role únicamente. Bloquea la fila del paquete (FOR UPDATE), verifica dueño, servicio, vigencia
-- y saldo, y suma credits_used. Devuelve false si no alcanza: entonces el servidor no crea la reserva.
public.bw_consume_pack_credits(p_pack uuid, p_client uuid, p_service text, p_variant int, p_n int) returns boolean
```

## 3. Servidor (sin archivos nuevos en `api/`)

- **Compra:** en `api/create-payment-intent.js` se añade `kind: 'pack'`.
  - El servidor calcula el monto (`computePackQuote` en `_lib/pricing.js`), crea `walk_packs` en `awaiting_payment` y el PaymentIntent con `metadata.kind = 'pack'`.
  - Se usa la misma protección de siempre: anti-bots, límite de intentos, `checkoutId` e idempotencia.
- **Activación:** en `api/stripe-webhook.js`, `payment_intent.succeeded` con `kind = 'pack'` hace lo siguiente:
  - verifica que el monto coincida;
  - pasa el paquete a `active`, con `expires_at = paid_at + 90 días`;
  - envía el correo de confirmación.
  - **No** crea paseos.
- **Uso:** en `api/create-payment-intent.js` se añade `usePackId` al reservar.
  - Se valida que el servicio y la duración de la reserva coincidan con los del paquete y que queden créditos para todos los días.
  - Créditos necesarios = número de días.
  - Con extras, se cobra solo `extras × días` con un PaymentIntent normal y se consumen los créditos cuando ese pago se confirma.
  - Sin extras, se consumen los créditos con `bw_consume_pack_credits`, se marca la reserva `paid` con `payment_method = 'pack'` y se crean los días con la misma función del webhook (`insertWalkDays`, movida a `_lib/`).
  - En la reserva, `per_day_list_cents` = precio de lista y `per_day_cents` = `unit_paid_cents`, más extras.
- **Ganancia del paseador:** `_lib/earnings.js → listPriceCents()` reconoce `pack_id` y usa `per_day_list_cents`. `walker_earning_std_cents` y `walker_earning_pro_cents` se guardan igual que hoy en `walk_requests`. El paseador **no ve** que fue un paquete ni ningún precio del cliente.
- **Pago al paseador:** `_lib/connect.js` usa la transferencia sin `source_transaction` cuando la reserva viene de un paquete, porque no tiene cargo propio. Sale del saldo de la plataforma y su `transfer_group` es el del paquete.
- **Cancelaciones de días pagados con paquete:** `_lib/cancellations.js` **devuelve el crédito** (`credits_used − 1`) en lugar de reembolsar dinero, con las mismas reglas del 100 % y el 50 %. En el caso del 50 %, se avisa al equipo.
- **Reembolsos y disputas:** `_lib/refunds.js` reconoce los cargos de tipo `pack`. Un reembolso total pasa el paquete a `refunded` y anula los créditos sin usar; una disputa lo pasa a `blocked`.
- **Agente de Finanzas:** reporta los ingresos diferidos (créditos vendidos sin usar) y los paquetes que vencen esta semana.

## 4. App (index.html y booking-flow.js)

- **Pestaña Club → sección "Paquetes":** elige servicio y duración, tamaño 4 u 8, y ve el precio por paseo, el ahorro y la vigencia. El pago usa los mismos Stripe Elements que hoy (tarjeta, Apple Pay o Google Pay).
- **Reserva, paso 4:** cuando hay créditos del mismo servicio, aparece la opción "🎟️ Usar mis créditos (quedan 5)". El total pasa a $0 o al importe de los extras, y el resumen lo explica.
- **Mi cuenta:** créditos restantes y fecha de vencimiento por paquete.

## 5. Términos

Hay que añadir una sección "Paquetes prepago" en `terminos-clientes.html` y subir la versión. La sección debe cubrir:
- precio y descuento;
- vigencia de 90 días, sin reembolso de créditos vencidos;
- reembolso proporcional de los créditos sin usar;
- que no se combina con el Club;
- que las cancelaciones devuelven créditos según la sección 6.

## 6. Pruebas a añadir

1. `computePackQuote`: 4 → −5 %, 8 → −10 %, redondeo por crédito y total.
2. Club + paquete: se aplica el mayor descuento, nunca los dos.
3. Consumo concurrente: dos reservas a la vez con 1 crédito, de las que solo una pasa (prueba SQL con roles).
4. Ganancia del paseador: un día de paquete paga 75 % u 80 % de **lista**, y `walk_requests` no contiene precios del cliente.
5. Webhook: activación idempotente y rechazo si el monto no coincide.
6. Cancelación de un día de paquete: devuelve el crédito y no hace reembolso de dinero.
7. Vencimiento: los créditos no se pueden usar después de `expires_at`.
8. Reembolso o disputa del paquete: los créditos se anulan o se bloquean.

## 7. Estimación

2 a 3 días, con pruebas y una prueba real de compra de 1 paquete y uso de 1 crédito.
