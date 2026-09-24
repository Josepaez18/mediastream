/**
 * Simula una sesión de reproducción completa contra Playback-Service:
 * pide el token DRM y luego reporta progreso hasta terminar el contenido.
 *
 * Uso:
 *   node scripts/simulate-playback.js <titleId> [profileId] [region]
 *   node scripts/simulate-playback.js 1 profile-42 CO
 */
const BASE = process.env.PLAYBACK_URL || 'http://localhost:3003';
const [, , titleId, profileId = 'profile-42', region = 'CO'] = process.argv;

if (!titleId) {
  console.error('Falta el titleId.\nUso: node scripts/simulate-playback.js <titleId> [profileId] [region]');
  process.exit(1);
}

const DURATION = 600; // 10 minutos de contenido simulado
const STEP = 120;     // reporta cada 2 minutos de contenido

async function main() {
  console.log(`\n1) Solicitando token DRM para el título ${titleId} en ${region}...`);
  const tokenRes = await fetch(
    `${BASE}/api/playback/token/${titleId}?profileId=${profileId}&region=${region}&deviceId=simulador-cli`,
  );
  const tokenBody = await tokenRes.json();

  if (!tokenRes.ok) {
    console.error('   No se pudo obtener el token:', JSON.stringify(tokenBody.message ?? tokenBody));
    process.exit(1);
  }

  console.log(`   Token emitido para "${tokenBody.titleName}"`);
  console.log(`   Sesión:   ${tokenBody.sessionId}`);
  console.log(`   Expira:   ${tokenBody.expiresAt} (${tokenBody.expiresInSeconds}s)`);
  console.log(`   Manifest: ${tokenBody.manifestUrl}`);
  console.log(`   JWT:      ${tokenBody.token.slice(0, 40)}...`);

  console.log(`\n2) Reportando progreso cada ${STEP}s de contenido...`);
  for (let pos = STEP; pos <= DURATION; pos += STEP) {
    const res = await fetch(`${BASE}/api/playback/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId,
        titleId,
        positionSeconds: pos,
        durationSeconds: DURATION,
        deviceId: 'simulador-cli',
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error('   Error guardando progreso:', JSON.stringify(body.message ?? body));
      process.exit(1);
    }
    console.log(
      `   ${String(pos).padStart(4)}s / ${DURATION}s  →  ${body.percentWatched}%${body.completed ? '  [COMPLETADO]' : ''}`,
    );
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n3) Consultando el punto de continuación de ${profileId}...`);
  const resumeRes = await fetch(`${BASE}/api/playback/resume/${profileId}?includeCompleted=true`);
  const resume = await resumeRes.json();
  console.log(JSON.stringify(resume, null, 2));
  console.log('\nListo. Si tienes corriendo listen-playback-events.js verás los eventos publicados.\n');
}

main().catch((err) => {
  console.error('Fallo la simulación:', err.message);
  console.error(`¿Está corriendo el servicio en ${BASE}?`);
  process.exit(1);
});
