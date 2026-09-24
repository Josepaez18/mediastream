/**
 * Suscriptor de prueba de los eventos que publica Playback-Service.
 *
 * Simula lo que hará Recommendation-Service: escuchar playback.progress y
 * playback.completed por Redis Pub/Sub para actualizar el modelo del perfil.
 *
 * Uso:
 *   node scripts/listen-playback-events.js
 *   REDIS_URL=redis://localhost:6380 node scripts/listen-playback-events.js
 */
const Redis = require('ioredis');

const url = process.env.REDIS_URL || 'redis://localhost:6380';
const sub = new Redis(url);

const CHANNELS = ['playback.progress', 'playback.completed'];

sub.subscribe(...CHANNELS, (err, count) => {
  if (err) {
    console.error('No se pudo suscribir:', err.message);
    process.exit(1);
  }
  console.log(`Escuchando ${count} canales en ${url}`);
  CHANNELS.forEach((c) => console.log(`  - ${c}`));
  console.log('\nEsperando eventos... (Ctrl+C para salir)\n');
});

sub.on('message', (channel, message) => {
  const stamp = new Date().toLocaleTimeString();
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch {
    parsed = message;
  }
  const marker = channel === 'playback.completed' ? '[COMPLETADO]' : '[progreso] ';
  console.log(`${stamp} ${marker} ${channel}`);
  console.log(JSON.stringify(parsed, null, 2));
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nCerrando suscriptor...');
  sub.quit().then(() => process.exit(0));
});
