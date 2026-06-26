# foundation-control-plane (D-1 reconcile) — controller-runtime
FROM golang:1.23-alpine AS build
WORKDIR /src
# 재현가능·공급망 무결성: 커밋된 go.mod/go.sum 으로 검증 다운로드, 빌드시 tidy 안 함(-mod=readonly).
COPY go.mod go.sum ./
RUN go mod download
COPY *.go *.yaml ./
RUN CGO_ENABLED=0 GOFLAGS=-mod=readonly go build -trimpath -o /out/manager .
FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/manager /manager
USER 65532:65532
ENTRYPOINT ["/manager"]
