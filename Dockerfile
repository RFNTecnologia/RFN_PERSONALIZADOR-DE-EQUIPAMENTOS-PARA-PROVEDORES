# Painel RFN do provedor: ACS TR-069 + painel web.
# Imagem multi-stage: compila o painel e roda o servidor Node sem dependencias.
#
#   docker compose up -d --build
#
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /opt/rfn-painel
ENV NODE_ENV=production \
    RFN_HOST=0.0.0.0 \
    RFN_PORT=8080 \
    RFN_DATA_DIR=/data
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs ./docs
COPY --from=build /app/README.md ./README.md
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server/index.mjs"]
