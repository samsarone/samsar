#!/usr/bin/env bash
set -Eeuo pipefail

required_variables=(
  MONGO_ROOT_USERNAME
  MONGO_ROOT_PASSWORD
  MONGO_APP_USERNAME
  MONGO_APP_PASSWORD
  MONGO_APP_DATABASE
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "MongoDB bootstrap requires ${variable_name}." >&2
    exit 1
  fi
done

if [[ "$MONGO_ROOT_USERNAME" == "$MONGO_APP_USERNAME" ]]; then
  echo 'MongoDB root and application usernames must be different.' >&2
  exit 1
fi

bootstrap_log=/tmp/samsar-mongo-bootstrap.log
mongo_started=0

shutdown_mongo() {
  if [[ "$mongo_started" == 1 ]]; then
    mongod --shutdown --dbpath /data/db >/dev/null 2>&1 || true
  fi
}
trap shutdown_mongo EXIT INT TERM

# This service has network_mode: none and MongoDB binds only to its own
# loopback interface. That makes the brief no-auth migration phase unreachable
# from both the host and other containers.
mongod \
  --dbpath /data/db \
  --bind_ip 127.0.0.1 \
  --port 27017 \
  --fork \
  --logpath "$bootstrap_log"
mongo_started=1

for _ in $(seq 1 60); do
  if mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.adminCommand({ ping: 1 })' >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! mongosh --quiet --host 127.0.0.1 --port 27017 --eval 'db.adminCommand({ ping: 1 })' >/dev/null 2>&1; then
  echo 'MongoDB bootstrap instance did not become ready.' >&2
  tail -n 40 "$bootstrap_log" >&2 || true
  exit 1
fi

mongosh --quiet --host 127.0.0.1 --port 27017 --eval '
  const adminDatabase = db.getSiblingDB("admin");
  const rootUsername = process.env.MONGO_ROOT_USERNAME;
  const rootPassword = process.env.MONGO_ROOT_PASSWORD;
  const appUsername = process.env.MONGO_APP_USERNAME;
  const appPassword = process.env.MONGO_APP_PASSWORD;
  const appDatabase = process.env.MONGO_APP_DATABASE;
  const appRoles = [
    { role: "readWrite", db: appDatabase },
    { role: "readWrite", db: "SamsarGallery" },
  ];

  if (adminDatabase.getUser(rootUsername)) {
    adminDatabase.updateUser(rootUsername, {
      pwd: rootPassword,
      roles: [{ role: "root", db: "admin" }],
    });
  } else {
    adminDatabase.createUser({
      user: rootUsername,
      pwd: rootPassword,
      roles: [{ role: "root", db: "admin" }],
    });
  }

  if (adminDatabase.getUser(appUsername)) {
    adminDatabase.updateUser(appUsername, { pwd: appPassword, roles: appRoles });
  } else {
    adminDatabase.createUser({ user: appUsername, pwd: appPassword, roles: appRoles });
  }
' >/dev/null

mongosh --quiet --host 127.0.0.1 --port 27017 --eval '
  const connection = new Mongo("mongodb://127.0.0.1:27017");
  const authenticated = connection.getDB("admin").auth({
    user: process.env.MONGO_APP_USERNAME,
    pwd: process.env.MONGO_APP_PASSWORD,
  });
  if (!authenticated) quit(2);
  connection.getDB(process.env.MONGO_APP_DATABASE).runCommand({ ping: 1 });
' >/dev/null

shutdown_mongo
mongo_started=0
trap - EXIT INT TERM
echo 'MongoDB users are configured for authenticated startup.'
