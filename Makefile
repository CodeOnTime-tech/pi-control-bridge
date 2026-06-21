BASEDIR := $(CURDIR)
SHELL := /bin/bash
NPM ?= npm

.PHONY: help install build test check version publish release stop install-local

help: ## Show available targets
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install npm dependencies
	$(NPM) install

build: ## Build bridge runtime (dist/bridge/main.js)
	$(NPM) run build

test: ## Run unit tests
	$(NPM) test

check: ## TypeScript type check
	$(NPM) run check

version:
	$(NPM) version patch --no-git-tag-version
	git add package.json package-lock.json
	git commit -m "Bump version"
	git push

stop: build ## Stop running bridge process
	node dist/bridge/main.js stop

publish: build ## Publish npm package
	$(NPM) publish

release: check test version publish

install-local: build ## Build and register this repo in the local Pi agent
	@echo "Removing stale dist/bridge/main.js entry (if any)..."
	-pi uninstall $(CURDIR)/dist/bridge/main.js
	pi install $(CURDIR)
