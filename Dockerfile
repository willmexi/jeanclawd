# Jean Clawd in cloud mode. Mount a volume at /data and set JEAN_TOKEN (jean cloud token makes one).
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV JEAN_DIR=/data JEAN_HOST=0.0.0.0 PORT=4242
VOLUME ["/data"]
EXPOSE 4242
CMD ["node", "server/server.js"]
