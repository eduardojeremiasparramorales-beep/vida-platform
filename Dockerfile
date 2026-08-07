FROM node:20-alpine

RUN apk add --no-cache tzdata ffmpeg \
  && cp /usr/share/zoneinfo/America/Bogota /etc/localtime \
  && echo "America/Bogota" > /etc/timezone
ENV TZ=America/Bogota

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

RUN mkdir -p public logs data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);if(j.status!=='ok'||!j.db)process.exit(1)})})"

CMD ["npm", "start"]
