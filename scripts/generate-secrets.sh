#!/bin/sh
set -eu
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "GENIEACS_UI_JWT_SECRET=$(openssl rand -hex 64)"
