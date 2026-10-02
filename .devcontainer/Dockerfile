FROM node:22.23.2-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        python3 \
        ca-certificates \
        bash \
        make \
        libasound2 \
        libgbm1 \
        libgtk-3-0 \
        libnss3 \
        libxss1 \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

USER node

WORKDIR /workspaces/protos-vscode-extension
