BASEDIR := $(CURDIR)
SHELL := /bin/bash
NPM ?= npm

.PHONY: help install build test check version publish release bridge-stop

help: 
	@echo "Usage: make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: 
	$(NPM) install

build: 
	$(NPM) run build

test: 
	$(NPM) test

check: 
	$(NPM) run check

version:
	$(NPM) version patch --no-git-tag-version
	git add package.json package-lock.json
	git commit -m "Bump version to $(VERSION)"
	git push

stop: build
	node dist/bridge/main.js stop

publish: build 
	$(NPM) publish

release: check test version publish 
