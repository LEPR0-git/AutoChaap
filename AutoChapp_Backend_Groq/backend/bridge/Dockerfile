FROM node:22-alpine
WORKDIR /srv
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js .
RUN mkdir -p sessions
EXPOSE 3100
CMD ["node","server.js"]
