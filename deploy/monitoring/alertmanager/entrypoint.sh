#!/bin/sh
set -eu
# Placeholders discard until real webhooks are set in compose env.
export SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-http://127.0.0.1:9/slack-placeholder}"
export PAGERDUTY_WEBHOOK_URL="${PAGERDUTY_WEBHOOK_URL:-http://127.0.0.1:9/pagerduty-placeholder}"
export EMAIL_WEBHOOK_URL="${EMAIL_WEBHOOK_URL:-http://127.0.0.1:9/email-placeholder}"
envsubst < /etc/alertmanager/alertmanager.yml.template > /tmp/alertmanager.yml
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager "$@"
