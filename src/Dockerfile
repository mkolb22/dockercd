# Stage 1: Build
FROM golang:1.24-alpine AS builder
ARG VERSION=dev
ARG COMMIT=unknown
RUN apk add --no-cache git
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
    -o /dockercd ./cmd/dockercd

# Stage 2: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates curl git docker-cli docker-cli-compose
COPY --from=builder /dockercd /usr/local/bin/dockercd
RUN mkdir -p /data /config/applications
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD curl -sf http://localhost:8080/healthz || exit 1
ENTRYPOINT ["dockercd"]
CMD ["serve"]
