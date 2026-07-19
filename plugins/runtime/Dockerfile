FROM docker.io/library/node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2
ARG PLUGIN_ID
ARG OS_MODULE_DESCRIPTOR
ARG OS_MODULE_SIGNATURE
LABEL org.opencontainers.image.title="OpenSphere Foundation Plugin" \
      org.opencontainers.image.source="https://github.com/opensphere-platform/OpenSphere-shell-foundation" \
      io.opensphere.module.descriptor=$OS_MODULE_DESCRIPTOR \
      io.opensphere.module.descriptor.signature=$OS_MODULE_SIGNATURE \
      io.opensphere.module.descriptor.key-id="opensphere-plugins-v4"
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV PORT=8080 PLUGIN_DIR=/plugins
WORKDIR /app
COPY plugins/runtime/server.js /app/server.js
COPY plugins/generated/${PLUGIN_ID}/ /plugins/
EXPOSE 8080
USER node
CMD ["node", "/app/server.js"]
