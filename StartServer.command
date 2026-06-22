#!/bin/bash
cd "$(dirname "$0")"
echo "Starting PureBluff Multiplayer Server..."
PATH="$PWD/node_bin/bin:$PATH" node server.js
