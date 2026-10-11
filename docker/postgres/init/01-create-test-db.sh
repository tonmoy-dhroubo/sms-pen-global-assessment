#!/bin/sh
# Runs once, the first time the Postgres volume is initialised (before that, the data
# directory is empty). Creates the second database used by integration tests (TEST_DATABASE_URL).
# To re-run it, reset the volume: npm run services:reset
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
	CREATE DATABASE sms_test OWNER "$POSTGRES_USER";
SQL
