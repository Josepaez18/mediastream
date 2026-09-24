# --- Etapa de build ---
FROM node:20-alpine AS builder
WORKDIR /app

# openssl: el motor de Prisma lo necesita en Alpine (musl).
RUN apk add --no-cache openssl

# npm ci instala exactamente lo que dice package-lock.json: la misma versión
# de cada dependencia en local, en el pipeline y en Render.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# --- Etapa de producción ---
# Se copian los node_modules ya instalados desde la etapa de build (con el
# cliente de Prisma generado y el CLI de Prisma fijado en package-lock), en
# vez de volver a instalar: así "npx prisma migrate deploy" usa siempre la
# versión del proyecto y nunca descarga otra de internet al arrancar.
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY scripts ./scripts

EXPOSE 3002

# DATABASE_NAME (solo en Render): los seis servicios comparten la instancia
# gratuita de Render Postgres, pero cada uno usa SU PROPIA base dentro de
# ella (database-per-service). Si está definida, reemplaza el nombre de la
# base al final de DATABASE_URL; si esa base no existe, "prisma migrate
# deploy" la crea. En local no se define y no cambia nada.
# Luego ejecuta las migraciones pendientes (con un reintento, por si otro
# servicio está creando su base en ese mismo instante) y arranca.
CMD ["sh", "-c", "if [ -n \"$DATABASE_NAME\" ]; then export DATABASE_URL=\"${DATABASE_URL%/*}/$DATABASE_NAME\"; fi; npx prisma migrate deploy || { sleep 5; npx prisma migrate deploy; } && node dist/main"]
