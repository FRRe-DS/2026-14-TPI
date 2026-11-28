#!/usr/bin/env bash
set -euo pipefail

commit="${1:?Falta el SHA a desplegar}"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]]

cd "$HOME/m4-g14"
exec 9> deploy/.despliegue.lock
flock 9

git fetch origin main
if [[ "$(git rev-parse FETCH_HEAD)" != "$commit" ]]; then
  echo "main avanzó desde $commit; se omite el despliegue de ese commit."
  exit 0
fi

compose() {
  sudo env "IMAGE_TAG=$1" docker compose -f deploy/compose.ambiente.yml "${@:2}"
}

previous_commit="$(git rev-parse HEAD)"
previous_tag="$(sed -n 's/^IMAGE_TAG=//p' deploy/.env)"
: "${previous_tag:?Falta IMAGE_TAG en deploy/.env}"

git checkout --detach "$commit"
if ! compose "$commit" up -d --no-deps --wait --wait-timeout 90 api ||
   ! curl --fail --silent --show-error --max-time 5 http://127.0.0.1/health/ready; then
  echo "Falló la verificación; se restaura $previous_commit." >&2
  git checkout --detach "$previous_commit"
  compose "$previous_tag" up -d --no-deps --wait --wait-timeout 90 api
  exit 1
fi

# El archivo local conserva la configuración de la base y el puerto público.
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$commit/" deploy/.env
echo "M4 G14 desplegado en $commit."
