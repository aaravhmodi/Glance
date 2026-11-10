FROM node:24-alpine AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
# postinstall copies the MediaPipe WASM into public/
RUN npm ci
COPY web/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
