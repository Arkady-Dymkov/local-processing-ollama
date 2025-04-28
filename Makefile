# Makefile for Ollama Transcript Processor Obsidian Plugin

# Variables
PLUGIN_ID := ollama-transcript-processor
TARGET_DIR := $(HOME)/obs/Personal/.obsidian/plugins/$(PLUGIN_ID)

# Default target
.PHONY: all
all: build

# Build the plugin
.PHONY: build
build:
	npm run build

# Deploy the plugin to the Obsidian plugins directory
.PHONY: deploy
deploy: build
	mkdir -p $(TARGET_DIR)
	cp main.js manifest.json styles.css $(TARGET_DIR)
	@echo "Plugin deployed to $(TARGET_DIR)"

# Clean build artifacts
.PHONY: clean
clean:
	rm -f main.js

# Help command
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make build   - Build the plugin"
	@echo "  make deploy  - Build and deploy the plugin to Obsidian"
	@echo "  make clean   - Clean build artifacts"
	@echo "  make help    - Show this help message"
