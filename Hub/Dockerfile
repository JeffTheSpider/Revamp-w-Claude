FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js config.json ./
COPY src/ src/
COPY public/ public/

EXPOSE 3000

CMD ["node", "server.js"]
