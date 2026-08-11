# Optional local Alertmanager webhook sink (no Slack/PagerDuty account needed)

Run beside local monitoring stack to capture alert POSTs:

```bash
# terminal 1
python deploy/scripts/local_alert_webhook_sink.py

# terminal 2 — point Alertmanager at http://host.docker.internal:9999/webhook
# or on Linux bridge: http://172.17.0.1:9999/webhook
```

Prints JSON bodies to stdout so you can verify routing without paid webhooks.
