#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

rm -f contracts/generated/ts/*.schema.d.ts contracts/generated/py/*_schema.py
mkdir -p contracts/generated/ts contracts/generated/py

pnpm exec json2ts -i contracts/schemas -o contracts/generated/ts

datamodel-codegen \
  --input contracts/schemas --input-file-type jsonschema \
  --output contracts/generated/py \
  --output-model-type pydantic_v2.BaseModel \
  --disable-timestamp --formatters black

echo "codegen done"
