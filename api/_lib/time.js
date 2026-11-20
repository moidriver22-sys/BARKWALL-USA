// Fechas y horas en la zona de Birmingham, AL (America/Chicago), sin librerías.
const ZONE = 'America/Chicago';

// Desfase (en minutos) de una zona horaria en un instante dado
function zoneOffsetMinutes(date, timeZone = ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

// 'YYYY-MM-DD' + 'HH:MM' en hora local de Birmingham → ISO UTC (maneja horario de verano)
function localToUtcIso(ymd, hm, timeZone = ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hm || '')) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, min] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let ts = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60000;
  ts = guess - zoneOffsetMinutes(new Date(ts), timeZone) * 60000; // segunda pasada por el cambio de horario
  return new Date(ts).toISOString();
}

function isValidTime(hm) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(hm || ''); }

module.exports = { ZONE, zoneOffsetMinutes, localToUtcIso, isValidTime };
