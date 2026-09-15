FROM node:22.23.2-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        python3 \
        ca-certificates \
        bash \
    && rm -rf /var/lib/apt/lists/*

USER node