#!/usr/bin/env bash
# Runs the API tests in Docker: a throwaway pgvector Postgres with the migrations, then `deno test`.
set -euo pipefail
here="$(cd "$(dirname "$0")/../../.." && pwd)"   # supabase/
net=attest-test-$$
trap 'docker rm -f $net-db >/dev/null 2>&1; docker network rm $net >/dev/null 2>&1' EXIT
docker network create $net >/dev/null
docker run -d --name $net-db --network $net -e POSTGRES_PASSWORD=test pgvector/pgvector:pg16 >/dev/null
until docker exec $net-db pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
for f in "$here"/local/*.sql "$here"/migrations/*.sql; do
  docker exec -i $net-db psql -q -v ON_ERROR_STOP=1 -U postgres < "$f" >/dev/null
done
docker run --rm --network $net -v "$here/functions:/functions" -w /functions/attest \
  -e DATABASE_URL=postgres://postgres:test@$net-db:5432/postgres \
  denoland/deno:2.1.4 test --allow-net --allow-env --allow-read tests/
