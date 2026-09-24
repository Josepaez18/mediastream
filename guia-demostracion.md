# Guía de demostración — MediaStream (6 microservicios)

Todos los comandos se ejecutan en **cmd**, desde la carpeta **`MediaStream`** (la que
contiene `docker-compose.yml` y las seis carpetas de servicios).

```
cd C:\Users\ASUS\OneDrive\Desktop\MediaStream
```

| Servicio | Consola | Color |
|---|---|---|
| User | http://localhost:3001 | violeta |
| Catalog | http://localhost:3002 | dorado |
| Playback | http://localhost:3003 | azul |
| Media Processing | http://localhost:3004 | rosa |
| Recommendation | http://localhost:3005 | verde azulado |
| Billing | http://localhost:3006 | lima |

---

## ANTES DE LA PRESENTACIÓN (mínimo 30 minutos antes)

La primera construcción tarda bastante: User y Billing instalan sus dependencias, Media
descarga FFmpeg y Recommendation instala sus librerías de cálculo. No lo dejes para último
momento.

### 1. Quitar contenedores viejos que chocan con el montaje nuevo

Los composes originales de User, del "tercer-micro" y de Billing usaban nombres y
puertos que ahora ocupa la plataforma completa (el de Billing, por ejemplo, ocupaba el
5434, que es de Playback). Esto los elimina (sus datos quedan en sus volúmenes; si no
existen, el comando no hace nada):

```
docker compose down
docker rm -f user-service-db user-service-rabbitmq media-db media-rabbitmq tercer-micro billing-service-db 2>nul
```

### 2. Levantar todo

Si quieres empezar con datos limpios (recomendado para la demo):

```
docker compose down -v
docker compose up -d --build
```

Si quieres conservar lo que ya tenías, omite el `down -v`.

Espera a que RabbitMQ termine de arrancar (~30 segundos) y verifica:

```
docker compose ps
```

Deben aparecer **14 contenedores** en `running`: 6 servicios, 6 bases de datos,
Redis y RabbitMQ.

### 3. Comprobar las seis consolas

Abre las seis URLs de la tabla de arriba. En la barra lateral de cualquiera, en
**Servicios**, los seis puntos deben estar **verdes**.

### 4. Preparar datos

**User** (`localhost:3001` → Cuenta → Registrar):

| Campo | Valor |
|---|---|
| Correo | `ana@correo.com` |
| Contraseña | `clave-segura-123` |
| Nombre del primer perfil | `Ana` |

Con datos limpios, la cuenta y el perfil de Ana tendrán el id **1**. Ese es el
perfil que usarás en Playback y en Recommendation.

Registra también una segunda cuenta, que es la que Billing va a restringir (así Ana
no se toca):

| Campo | Valor |
|---|---|
| Correo | `beto@correo.com` |
| Contraseña | `clave-segura-123` |
| Nombre del primer perfil | `Beto` |

Con datos limpios, Beto es la cuenta **2**.

**Catalog** (`localhost:3002` → Crear título):

| Campo | Valor |
|---|---|
| Nombre | `El Último Meridiano` |
| Sinopsis | `Una piloto retirada debe cruzar una zona horaria en cuarentena para entregar la única cura conocida antes de que expire.` |
| Tipo | `MOVIE` |
| Clasificación | `PG-13` |
| Categoría | `Acción` |
| Región | `CO` **(en mayúsculas)** |
| Disponible desde | **vacío** |
| Disponible hasta | vacío |

Con datos limpios será el título **1**. Queda en `PENDING`: **no lo publiques
todavía**. Que Media lo vuelva disponible es uno de los momentos fuertes.

**Títulos de demostración** (14 títulos de 6 géneros, ya disponibles en CO y MX,
para que Recommendation tenga entre qué recomendar):

```
docker compose exec catalog-service node scripts/cargar-titulos-demo.js
```

Quedan con los ids 2 a 15. **Hazlo después** de crear "El Último Meridiano".

**Deja el stack corriendo.** No lo apagues hasta después de presentar.

---

## DURANTE LA PRESENTACIÓN

### Ventanas a tener abiertas

| Ventana | Contenido |
|---|---|
| Navegador | las 6 consolas, una por pestaña |
| Terminal A | libre, para comandos |
| Terminal B | logs de Catalog, Media, User y Billing (paso 0) |
| Terminal C | listener de eventos de Playback (paso 0) |

### Paso 0 — Terminales de fondo

**Terminal B**: aquí vas a ver a Catalog recibir el evento de Media, y a User recibir
el de Billing.

```
docker compose logs -f --tail 0 catalog-service media-processing-service user-service billing-service
```

**Terminal C**: eventos de reproducción en vivo.

```
docker compose exec playback-service node scripts/listen-playback-events.js
```

---

### Paso 1 — Seis servicios, seis bases

```
docker compose ps
```

Señala: seis servicios, **seis bases de datos distintas**, y Redis/RabbitMQ
compartidos solo como medio de comunicación. Menciona que Media y Recommendation
están en **Python** y los otros cuatro en **Node.js**, y que solo la base de
Recommendation tiene la extensión **pgvector**: cada servicio usa la tecnología que
le conviene.

### Paso 2 — Bases de datos independientes

```
docker compose exec user-db psql -U user_service -d user_service_db -c "\dt"
docker compose exec catalog-db psql -U catalog_user -d catalog_db -c "\dt"
docker compose exec playback-db psql -U playback_user -d playback_db -c "\dt"
docker compose exec media-db psql -U media_user -d media_processing_db -c "\dt"
docker compose exec recommendation-db psql -U reco_user -d recommendation_db -c "\dt"
docker compose exec billing-db psql -U billing_service -d billing_service_db -c "\dt"
```

Frase clave: *"Ningún servicio puede leer las tablas de otro. Si necesita un dato,
lo pide por la API o reacciona a un evento."*

---

### Paso 3 — User: identidad y perfiles (`localhost:3001`)

1. **Cuenta** → Iniciar sesión con `ana@correo.com` / `clave-segura-123`.
2. **Perfiles** → Consultar. Aparece "Ana", leído con el AccessToken JWT.
3. **Restricción de acceso** → explica que la cuenta se restringe cuando llega
   `payment.failed` por RabbitMQ. Quien lo publica es Billing: lo verás en vivo en el
   paso 9. **No pulses** *Simular pago fallido* aquí, o Beto llegará con fallos de más.

---

### Paso 4 — Catalog: el título existe pero no se ofrece (`localhost:3002`)

Busca con región `CO`: aparecen los 14 títulos de demostración, pero **no** "El
Último Meridiano". Confírmalo en la base:

```
docker compose exec catalog-db psql -U catalog_user -d catalog_db -c "select id, name, status from title order by id;"
```

El título 1 está `PENDING`: el vídeo todavía no se ha procesado, así que no se ofrece.

### Paso 5 — Media Processing: el evento que lo cambia todo (`localhost:3004`)

**Nuevo ingest**:
- Title ID: `1`
- Archivo: `media-processing-service\samples\muestra-5s.mp4` (dentro de la carpeta MediaStream)
- Iniciar transcodificación

La consola salta sola a **Jobs** y verás el estado avanzar:
`pending` → `processing` → `completed`.

Mientras tanto, **señala la Terminal B**: aparece
`Evento media.ready recibido para título 1` en los logs de Catalog.

Vuelve a **Catalog**, busca con región `CO`: **"El Último Meridiano" ya aparece**,
`AVAILABLE`.

Frase clave: *"Media no llamó a Catalog ni tocó su base de datos. Publicó
`media.ready` en RabbitMQ y Catalog reaccionó. Ninguno de los dos sabe que el otro
existe; solo comparten el contrato del evento."*

### Paso 6 — El camino de error

En **Catalog**, crea otro título (`Prueba de error`, `MOVIE`, región `CO`). Anota su
id (con datos limpios será `16`).

En **Media** → Nuevo ingest, con ese Title ID y el archivo
`media-processing-service\samples\archivo-corrupto.mp4`.

El job termina en `error` y Media publica `media.processing.failed`:

```
docker compose exec catalog-db psql -U catalog_user -d catalog_db -c "select id, name, status from title where id in (1, 16);"
```

El título quedó `UNAVAILABLE`, no huérfano en `PENDING`.

---

### Paso 7 — Playback: comunicación síncrona (`localhost:3003`)

El **Perfil activo** de la barra lateral ya viene en `1` (Ana, el id de User).

**Token DRM**: ID del título `1`, región `CO` → Solicitar token. Se emite el JWT.

Explica: *"Playback llamó por HTTP a Catalog para verificar que el título exista,
esté disponible y tenga licencia en Colombia. Solo entonces firmó el token."*

Cambia la región a `AR` → **451** (*Unavailable For Legal Reasons*, sección 4.4). Sin licencia
regional, no hay reproducción.

Vuelve a `CO`, pide el token, ve a **Reproductor**, dale **Reproducir** y
**Saltar +60s** hasta pasar el 95%. **Señala la Terminal C**: llegan los
`playback.progress` y al final `playback.completed`.

**Seguir viendo** → aparece el progreso guardado.

---

### Paso 8 — Recommendation: el modelo aprende de lo que ves (`localhost:3005`)

**Eventos**: los mismos `playback.progress` y `playback.completed` que acabas de ver
en la Terminal C llegaron aquí por Redis, con el estado *procesado*. Arriba:
suscriptor conectado y 15 títulos sincronizados desde Catalog.

**Para ti** (perfil `1`, región `CO`): Ana vio una película de acción, así que arriba
salen **las otras tres de acción**, cada una explicada con *"Se parece a «El Último
Meridiano», que ya viste"*. Pasa el mouse por la barra de una: se ve cuánto aporta el
contenido y cuánto el colaborativo. Por ahora el colaborativo es casi cero: Ana es la
única usuaria.

Ahora simula que la plataforma tiene más usuarios (18 perfiles con gustos distintos,
publicando eventos en Redis igual que Playback):

```
docker compose exec recommendation-service python scripts/simular_audiencia.py
```

Mira **Eventos** llenarse, y vuelve a **Para ti** (se actualiza sola cada 3 segundos).
Ahora aparece **"Órbita Cero"**, que es de *ciencia ficción*, con la explicación
*"Lo vieron N perfiles con gustos parecidos a los tuyos"*.

Frase clave: *"Por contenido, Órbita Cero no se parece a lo que vio Ana. La recomienda
el filtrado colaborativo: a quienes les gusta la acción, como a Ana, también les
gustó esa película. Eso es lo que hace un sistema híbrido."*

Para cerrar esta parte:

- **Perfil**: historial de Ana, sus gustos por género y sus perfiles más parecidos
  (los vecinos que encuentra pgvector en `profile_embedding`).
- **Títulos similares**: ID `1` → los más cercanos en `content_embedding`.
- En **Para ti**, activa **Perfil infantil**: solo quedan títulos G y PG. Explica que
  eso lo decide Catalog, el dueño del control parental; Recommendation solo ordena.

---

### Paso 9 — Billing: un cobro rechazado restringe la cuenta (`localhost:3006`)

1. **Suscripción**: ID de cuenta `2` (Beto), plan *Estándar*, tarjeta
   `4242 4242 4242 4242` → **Suscribirse**. Queda *Activa*. Anota el número de
   suscripción (con datos limpios, **#1**).
2. **Historial de pagos**: cuenta `2` → el primer cobro, *Exitoso*.
3. **Aviso de pago**: suscripción `1`, resultado *Pago rechazado* → **Enviar aviso**.
   Simula que la renovación mensual falló. **Señala la Terminal B**: primero Billing
   (`Evento payment.failed publicado para la cuenta 2`) y enseguida User
   (`Cuenta 2: intento fallido #1 -> estado MOROSA`).
4. En **User** (`localhost:3001`), inicia sesión como Beto: en la barra lateral la cuenta
   aparece **MOROSA**.
5. Envía el mismo aviso dos veces más. Al tercero, User la marca **SUSPENDIDA**: intenta
   iniciar sesión como Beto → **403**.

Si quieres mostrar los otros dos resultados de la pasarela, en **Suscripción** usa otra
cuenta (por ejemplo `1`, Ana):

- `4000 0000 0000 0002` → **402**, pago rechazado (y `payment.failed`).
- Cualquier otro número, por ejemplo `1234` → **202**, *pago pendiente*: la pasarela no
  respondió, y eso **no** se trata como un rechazo, así que no se restringe la cuenta.

Ojo: el rechazado le suma un fallo a Ana (quedaría `MOROSA`). Playback no lo revisa, así
que la demo sigue igual, pero si prefieres no tocarla, muéstralo solo con el pendiente.

Frase clave: *"Billing no llamó a User ni tocó su base de datos. Guardó el pago fallido
en la suya y publicó `payment.failed`; User reaccionó por su cuenta. Es la acción
compensatoria del patrón Saga, y va por RabbitMQ porque ese evento no puede perderse."*

---

### Paso 10 — Independencia: el momento fuerte

Antes de apagar nada, crea en **Catalog** un título más (`Estreno pendiente`,
`MOVIE`, región `CO`). Anota su id (con datos limpios será `17`). Queda `PENDING`.

**10a. Apagar Recommendation: la reproducción ni se entera.**

```
docker compose stop recommendation-service
```

En cualquier consola, Recommendation se pone **rojo** en *Servicios*. Ve a
**Playback** y reproduce otra vez: funciona igual. Playback publica en Redis y sigue
adelante; que nadie esté escuchando no le importa.

```
docker compose start recommendation-service
```

**10b. Apagar Catalog: los demás degradan, no se caen.**

```
docker compose stop catalog-service
```

1. En *Servicios*, Catalog se pone **rojo**; los otros cinco siguen verdes.
2. **Playback** sigue vivo:

```
curl http://localhost:3003/health
```

   Pide otra vez el token del título `1` en CO: **sale bien**, y en *Verificación* dice
   *"última información conocida: Catalog no responde"*. Pídelo tres veces: el
   **circuit breaker** se abre y Playback deja de llamar a Catalog durante 30 s
   (`catalogCircuit: "OPEN"` en *Health*). Un título que Playback nunca había consultado
   responde **503**. Es lo que piden las secciones 4.5–4.7: timeout de 2 s, 2 reintentos
   con backoff y circuit breaker. Registrar progreso **sí** funciona siempre:

```
curl -X POST http://localhost:3003/api/playback/progress -H "Content-Type: application/json" -d "{\"profileId\":\"1\",\"titleId\":\"1\",\"positionSeconds\":45,\"durationSeconds\":600}"
```

3. **Recommendation sigue recomendando**: en *Para ti* aparece el aviso *"Catalog-Service
   no responde: se recomienda sin filtrar por región ni control parental"*, pero la
   lista sale igual, porque tiene sus propios vectores. (Si recargas la página, los
   títulos se ven por ID: los nombres también vienen de Catalog.)
4. **Media sigue trabajando sin Catalog**: Nuevo ingest con el Title ID `17` y
   `muestra-5s.mp4`. El job llega a `completed`.
5. **El evento no se perdió**: abre http://localhost:15672 (`guest` / `guest`) →
   **Queues** → `catalog.media-events` tiene **1 mensaje** esperando.

Levanta el catálogo:

```
docker compose start catalog-service
```

En la Terminal B verás a Catalog procesar el evento pendiente. Confírmalo:

```
docker compose exec catalog-db psql -U catalog_user -d catalog_db -c "select id, name, status from title where id = 17;"
```

El título 17 está `AVAILABLE`.

Frase clave: *"En un monolito, la caída del catálogo tumba todo. Aquí Playback solo
perdió la emisión de tokens, Recommendation siguió recomendando, Media siguió
procesando, y el evento esperó en RabbitMQ hasta que Catalog volvió. Nada se perdió."*

**10c. Apagar User: Billing sigue cobrando.**

```
docker compose stop user-service
```

1. En **Billing** → **Aviso de pago**: suscripción `1`, *Pago rechazado* → responde
   igual. Billing no necesita a User para funcionar.
2. En http://localhost:15672 → **Queues** → `user_service.payment_failed` tiene
   **1 mensaje** esperando.

```
docker compose start user-service
```

En la Terminal B, User procesa el mensaje pendiente al arrancar
(`Cuenta 2: intento fallido #4 -> estado SUSPENDIDA`) y la cola vuelve a 0.

### Paso 11 (opcional) — El script automático

Con Git Bash:

```
bash scripts/verificar-independencia.sh
```

Revisa las seis bases, reinicia servicios, comprueba que `payment.failed` espere en la
cola con User apagado y busca imports cruzados. Tarda ~1 minuto y apaga/enciende Catalog
y User: ensáyalo antes. Crea una suscripción de prueba para la cuenta `999999999`, que
User ignora porque no existe.

### Paso 12 — La documentación

- http://localhost:3001/docs
- http://localhost:3002/docs
- http://localhost:3003/docs
- http://localhost:3004/docs (FastAPI la genera sola)
- http://localhost:3005/docs (FastAPI la genera sola)
- http://localhost:3006/docs

---

## SI ALGO FALLA

### "container name already in use" o "port is already allocated" al levantar

Quedaron contenedores de los composes viejos. Repite el paso 1 de la preparación.
Para ver qué está ocupando puertos:

```
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

### Un punto rojo en *Servicios*

Ese servicio no responde. Mira por qué:

```
docker compose logs --tail 50 recommendation-service
```

(cambia el nombre por el servicio en rojo).

### El job de Media se queda en `pending` o `processing`

```
docker compose logs --tail 80 media-processing-service
```

Con `muestra-5s.mp4` debe terminar en unos segundos. Si subes un vídeo largo, la
transcodificación a cuatro resoluciones puede tardar minutos.

### El título no pasa a AVAILABLE después del ingest

1. Revisa que el Title ID del ingest sea el id real del título en Catalog.
2. Mira la Terminal B: debe aparecer `Evento media.ready recibido`.
3. Si no aparece, revisa que Catalog esté conectado a RabbitMQ:

```
docker compose logs --tail 30 catalog-service
```

### El catálogo aparece vacío aunque el título esté AVAILABLE

Escribe `CO` en el campo Región. Con el campo vacío, el catálogo busca la región
`GLOBAL`, no todas.

### Recommendation no muestra títulos, o dice "Nada que recomendar"

Todavía no sincronizó el catálogo (lo hace cada 60 s). En su consola, pestaña
**Eventos**, pulsa **Sincronizar catálogo ahora**. Si Catalog no tiene títulos
disponibles en CO, carga los de demostración:

```
docker compose exec catalog-service node scripts/cargar-titulos-demo.js
```

### En Eventos aparecen como *ignorado*

El perfil de Playback no es numérico (por ejemplo `profile-42`). En la consola de
Playback pon el **Perfil activo** en `1`: Recommendation, como User, usa ids numéricos.

### Billing rechaza el pago pero la cuenta no cambia en User

1. Revisa que el ID de cuenta de Billing exista en User. Si no existe, User lo ignora
   y en sus logs aparece `payment.failed recibido para una cuenta inexistente`.
2. Mira si Billing pudo publicar:

```
docker compose logs --tail 30 billing-service
```

   Si dice `No se pudo publicar payment.failed`, RabbitMQ no estaba disponible en ese
   momento. Billing reconecta solo en el siguiente evento: vuelve a enviar el aviso.
3. En la consola de User, **vuelve a iniciar sesión**: el estado de la barra lateral es
   el del último login, no se actualiza solo.

### Reiniciar un servicio sin tocar los demás

```
docker compose restart media-processing-service
```

### Empezar de cero (último recurso, borra los datos)

```
docker compose down -v
docker compose up -d --build
```

---

## DESPUÉS DE PRESENTAR

```
docker compose down
```

Sin `-v`, para conservar los datos para la próxima vez.

---

## RESUMEN DE COMANDOS

```
docker compose up -d --build                     levantar todo
docker compose ps                                ver estado
docker compose logs -f recommendation-service    ver logs de uno
docker compose restart playback-service          reiniciar uno
docker compose stop catalog-service              apagar uno
docker compose start catalog-service             encender uno
docker compose down                              apagar todo
docker compose down -v                           apagar y borrar datos

docker compose exec catalog-service node scripts/cargar-titulos-demo.js
docker compose exec recommendation-service python scripts/simular_audiencia.py
docker compose exec user-service node scripts/simulate-payment-failed.js 2   (sin pasar por Billing)
docker compose exec playback-service node scripts/listen-playback-events.js
docker compose exec catalog-service node scripts/publish-media-ready.js 1

docker compose exec user-db psql -U user_service -d user_service_db
docker compose exec catalog-db psql -U catalog_user -d catalog_db
docker compose exec playback-db psql -U playback_user -d playback_db
docker compose exec media-db psql -U media_user -d media_processing_db
docker compose exec recommendation-db psql -U reco_user -d recommendation_db
docker compose exec billing-db psql -U billing_service -d billing_service_db
```

---

## LAS CINCO FRASES QUE DEBES DECIR

1. **"Cada servicio tiene su propia base de datos."** Ninguno puede leer las tablas
   de otro; tiene que preguntar por la API o reaccionar a un evento. Por eso un
   cambio de esquema en uno no rompe a los demás.

2. **"Se comunican de dos formas según la necesidad."** Síncrona por REST cuando la
   respuesta condiciona una decisión (¿hay licencia en esta región?), y asíncrona
   por eventos cuando solo hay que avisar algo (el vídeo está listo, Ana vio algo,
   un cobro fue rechazado).

3. **"Los eventos importantes no se pierden."** `media.ready` y `payment.failed` van
   por RabbitMQ: si el consumidor está caído, esperan en la cola. Los de alto
   volumen y poco valor individual, como `playback.progress`, van por Redis.

4. **"Cada servicio usa la tecnología que le conviene."** Python para vídeo y
   recomendaciones, Node.js para el negocio, y pgvector solo donde hace falta
   buscar por similitud. Los demás ni se enteran.

5. **"La caída de uno no tumba a los otros."** Es lo que separa microservicios de un
   monolito distribuido, y se ve en vivo: los puntos del selector de servicios lo
   muestran en las seis consolas.
