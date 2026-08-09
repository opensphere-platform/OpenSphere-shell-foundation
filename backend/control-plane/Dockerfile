# foundation-control-plane (D-1 reconcile) — controller-runtime
FROM docker.io/library/golang:1.25-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587 AS build
WORKDIR /src
# 재현가능·공급망 무결성: 커밋된 go.mod/go.sum 으로 검증 다운로드, 빌드시 tidy 안 함(-mod=readonly).
COPY go.mod go.sum ./
RUN go mod download
COPY *.go *.yaml *.json *.tar.gz ./
RUN CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -o /out/manager .
FROM gcr.io/distroless/static:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6
ARG OS_RELEASE_TAG=unknown
ARG OS_SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="OpenSphere Foundation Control Plane" \
      org.opencontainers.image.version=$OS_RELEASE_TAG \
      org.opencontainers.image.revision=$OS_SOURCE_REVISION \
      org.opencontainers.image.source="https://github.com/opensphere-platform/OpenSphere-shell-foundation" \
      io.opensphere.channel="edge" \
      io.opensphere.release-tag=$OS_RELEASE_TAG \
      io.opensphere.source-revision=$OS_SOURCE_REVISION \
      opensphere.io/build-authority="localhost" \
      opensphere.io/ga-eligible="false" \
      opensphere.io/release-class="pre-ga"
COPY --from=build /out/manager /manager
USER 65532:65532
ENTRYPOINT ["/manager"]
