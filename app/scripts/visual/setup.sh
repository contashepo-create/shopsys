#!/bin/bash
set -e
mkdir -p /home/user/tools/shot && cd /home/user/tools/shot
[ -d node_modules/puppeteer-core ] || { npm init -y >/dev/null 2>&1; npm i --no-audit --no-fund puppeteer-core @sparticuz/chromium >/dev/null 2>&1; }
[ -f /tmp/al2023/lib/libnss3.so ] || { node -e "const{createReadStream,createWriteStream}=require('fs');const{createBrotliDecompress}=require('zlib');createReadStream('./node_modules/@sparticuz/chromium/bin/al2023.tar.br').pipe(createBrotliDecompress()).pipe(createWriteStream('/tmp/al2023.tar')).on('finish',()=>process.exit(0))"; sleep 1; mkdir -p /tmp/al2023; tar -xf /tmp/al2023.tar -C /tmp/al2023; }
cp /home/user/shopsys/app/scripts/visual/*.mjs /home/user/tools/shot/
echo "shot tools ready"
