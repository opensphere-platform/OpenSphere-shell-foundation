# OpenSphere subShell: foundation — standalone build.
#   Stage 1: build the Angular 22 app (Angular Element <osp-foundation-shell>) → dist/foundation/browser
#            (angular.json: @angular/build:application, outputHashing=none → predictable main.js + styles.css)
#   Stage 2: runtime feature-container — server.js serves the built bundle at /app/www + signed ui-shell at
#            /app/plugins + generic /api/k8s/* proxy + WS exec. ws is the only runtime dep (rest are node built-ins).
FROM docker.io/library/node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src ./src
RUN npx ng build --configuration production

FROM docker.io/library/node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
ARG OS_MODULE_DESCRIPTOR
ARG OS_MODULE_SIGNATURE
LABEL org.opencontainers.image.title="OpenSphere Platform Foundation Service Stack" \
      org.opencontainers.image.version="0.2.0-edge.11" \
      org.opencontainers.image.source="https://github.com/opensphere-platform/OpenSphere-shell-foundation" \
      io.opensphere.module.descriptor=$OS_MODULE_DESCRIPTOR \
      io.opensphere.module.descriptor.signature=$OS_MODULE_SIGNATURE \
      io.opensphere.module.descriptor.key-id="opensphere-plugins-v4"
RUN apk upgrade --no-cache
WORKDIR /app
RUN npm install --omit=dev --no-audit --no-fund --no-save ws@8.21.0 \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --chmod=0644 server.js /app/server.js
COPY ui-shell/ /app/plugins/
COPY --chmod=0644 module-package.json module-package.json.sig /app/plugins/
COPY --from=build /app/dist/foundation/browser /app/www
# 인증 CA는 이미지에 굽지 않는다. Console Extension Host가 Setup-managed
# opensphere-console-auth-ca Secret을 /etc/opensphere/auth-ca에 read-only로 마운트한다.
ENV PLUGINS_DIR=/app/plugins WWW_DIR=/app/www PORT=8080 \
    NODE_EXTRA_CA_CERTS=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt \
    KANIDM_CA_PATH=/etc/opensphere/auth-ca/ca.crt
EXPOSE 8080
USER 1000
CMD ["node", "/app/server.js"]
