# --- Etapa de build ---
FROM node:20-alpine AS builder
WORKDIR /app

# npm ci instala exactamente lo que dice package-lock.json: la misma versión
# de cada dependencia en local, en el pipeline y en Render.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# --- Etapa de producción ---
# Notification-Service no tiene base de datos relacional (usa Redis), así que
# a diferencia de los demás servicios Node no ejecuta migraciones al arrancar.
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3007
CMD ["node", "dist/main"]
