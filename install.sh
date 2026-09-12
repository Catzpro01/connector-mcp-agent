#!/usr/bin/env bash
set -e

echo "Installing Connector MCP Agent..."
npm install
npm run build
npm install -g .

echo "=================================================="
echo " Connector CLI installed successfully!"
echo " Try: connector-cli --version"
echo "      connector-cli status"
echo "=================================================="
