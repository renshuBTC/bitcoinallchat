#!/bin/sh
# Rebuilds post.js from post-src.js and prints the hash to compare against the
# integrity attribute in index.html. Pinned versions, so the bytes come out the
# same on any machine.
set -eu
npm install
npx esbuild entry.js --bundle --minify --format=iife --target=es2020 --outfile=post.js
printf 'sha384-'
openssl dgst -sha384 -binary post.js | openssl base64 -A
echo
