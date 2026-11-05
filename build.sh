#!/bin/sh
# Assemble slab.js et ses dépendances en un seul paquet servi par le site .
# Usage : NODE_PATH=<node_modules avec three> ./build.sh
set -e
esbuild="$NODE_PATH/.bin/esbuild"
"$esbuild" slab.js --bundle --format=esm --splitting --minify --target=safari15 --outdir=dist --chunk-names=[name]-[hash]
mkdir -p geo/draco
cp "$NODE_PATH/three/examples/jsm/libs/draco/draco_wasm_wrapper.js" "$NODE_PATH/three/examples/jsm/libs/draco/draco_decoder.wasm" geo/draco/
ls -la dist geo/draco | awk '{print $5, $9}'
