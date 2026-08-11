FROM alpine:3.20
RUN apk add --no-cache ca-certificates gettext \
  && wget -qO /tmp/am.tar.gz \
    https://github.com/prometheus/alertmanager/releases/download/v0.27.0/alertmanager-0.27.0.linux-amd64.tar.gz \
  && tar -xzf /tmp/am.tar.gz -C /tmp \
  && mv /tmp/alertmanager-0.27.0.linux-amd64/alertmanager /bin/alertmanager \
  && rm -rf /tmp/am.tar.gz /tmp/alertmanager-0.27.0.linux-amd64
COPY alertmanager.yml.template /etc/alertmanager/alertmanager.yml.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 9093
ENTRYPOINT ["/entrypoint.sh"]
