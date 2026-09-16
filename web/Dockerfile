# Build with this directory as context:
# docker build --file web/Dockerfile --tag dockercd-web:local web
FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /dockercd-web ./cmd/dockercd-web

# The presentation fixture has no runtime OS dependencies. A scratch image
# makes the privilege boundary auditable: no shell, package manager, Docker,
# Git, SQLite, CA bundle, or controller secret is present in this image.
FROM scratch
COPY --from=builder /dockercd-web /dockercd-web
USER 65532:65532
EXPOSE 8092
ENTRYPOINT ["/dockercd-web"]
