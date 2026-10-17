# Frontend — MediaStream

Aplicación web de MediaStream, una plataforma de streaming construida con microservicios. Es lo que usa la persona: inicio de sesión y registro, perfiles, catálogo con Top 10 y recomendaciones, reproductor con tráileres, planes y pago con PayPal, y un panel de administración. No tiene base de datos: todo lo pide al API Gateway.

La plataforma completa (docker-compose, `render.yaml` y CI/CD) está en [Josepaez18/mediastream](https://github.com/Josepaez18/mediastream).

## Enlaces

| | |
| --- | --- |
| Aplicación publicada (Render, Static Site) | https://mediastream-app.onrender.com |
| API Gateway que consume | https://mediastream-gateway-5wjw.onrender.com |
| Repositorio | https://github.com/Josepaez18/mediastream-frontend |

## Tecnologías

HTML, CSS y JavaScript sin frameworks ni paso de compilación. Usa dos integraciones externas:

- **PayPal JS SDK** (modo sandbox) para pagar los planes.
- **YouTube IFrame API** para reproducir los tráileres; si un tráiler no se puede ver, pasa a un video de muestra.

## Pantallas

| Ruta | Pantalla |
| --- | --- |
| `#/login`, `#/registro` | Inicio de sesión y registro (si el correo no existe, lleva a registrarse) |
| `#/perfiles` | ¿Quién está viendo? Crear y eliminar perfiles según el plan |
| `#/inicio`, `#/series`, `#/peliculas` | Catálogo con título destacado, Top 10, "seguir viendo" y recomendaciones |
| `#/buscar` | Búsqueda y filtro por categoría |
| `#/ver/:id` | Reproductor (tráiler de YouTube o video de muestra) que guarda el progreso |
| `#/planes`, `#/cuenta` | Planes, pago con PayPal, historial y cancelación |
| `#/admin/:pestaña` | Administración (solo cuentas ADMIN): resumen con KPIs, catálogo, usuarios, suscripciones, subir video y estado de los servicios |

## Configuración

No usa variables de entorno porque es un sitio estático. Las URLs de los servicios están en `config.js`; si se abre en `localhost`, habla con el gateway local (`http://localhost:8080`).

## Ejecución en local

Con la plataforma corriendo (`docker compose up -d` en el repositorio principal), sirve esta carpeta con cualquier servidor estático:

```bash
python -m http.server 3000
```

Queda en http://localhost:3000. La cuenta administradora local es `admin@mediastream.com` con la contraseña `Admin12345!` (definida en el docker-compose; la de producción es otra).
