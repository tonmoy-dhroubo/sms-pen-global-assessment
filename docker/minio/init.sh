#!/bin/sh
# One-shot bucket setup for local MinIO. Idempotent: safe to run on every `docker compose up`.
#   1. wait for the server
#   2. create the private bucket if it does not exist
#   3. make sure anonymous access is off
# CORS is not set here: MinIO has no per-bucket CORS API, so it is configured on the server
# (MINIO_API_CORS_ALLOW_ORIGIN in docker-compose.yml).
set -eu

: "${MINIO_ENDPOINT:?}" "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${S3_BUCKET:?}"

until mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "waiting for MinIO at $MINIO_ENDPOINT ..."
  sleep 1
done

mc mb --ignore-existing "local/$S3_BUCKET"
mc anonymous set none "local/$S3_BUCKET"

echo "bucket '$S3_BUCKET' ready (private)"
