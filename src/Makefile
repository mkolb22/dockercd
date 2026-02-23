BINARY := dockercd
PKG := github.com/mkolb22/dockercd
VERSION ?= dev
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
LDFLAGS := -ldflags "-X main.version=$(VERSION) -X main.commit=$(COMMIT)"

.PHONY: build test test-race lint clean docker fmt vet

build:
	go build $(LDFLAGS) -o bin/$(BINARY) ./cmd/dockercd

test:
	go test ./... -count=1

test-race:
	go test ./... -race -count=1

test-cover:
	go test ./... -coverprofile=coverage.out -count=1
	go tool cover -func=coverage.out

lint:
	golangci-lint run ./...

vet:
	go vet ./...

fmt:
	gofmt -s -w .

clean:
	rm -rf bin/ coverage.out

docker:
	docker build -t $(BINARY):$(VERSION) .

tidy:
	go mod tidy
