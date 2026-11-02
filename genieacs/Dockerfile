FROM node:22-bookworm-slim

WORKDIR /opt/genieacs
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ libxml2-dev libxml2-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --global genieacs@1.2.16

RUN mkdir -p /opt/genieacs/ext /opt/genieacs/config /var/log/genieacs

COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 7547 7557 7567 3000
ENTRYPOINT ["/start.sh"]
