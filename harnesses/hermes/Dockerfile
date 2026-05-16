# hermes TUI harness
#
# Browser <--ws--> this container <--pty--> hermes CLI (Nous Research)
#
# Hermes is a Python project; we install it from a pinned release tag using
# uv. The Node WS bridge is the same pattern as the claude-code and codex
# harnesses — it just spawns the configured POC_CMD (default `hermes --tui`)
# inside a PTY.
#
# Build from repo root:
#   docker buildx build -f harnesses/hermes/Dockerfile -t hermes-sandbox:dev .

FROM node:20-bookworm-slim

# Build deps for node-pty's native binding + runtime deps for both the WS
# bridge and the Hermes Python install (python3, git for clone, ripgrep for
# hermes's code search, build tools for any pure-Python wheels that need
# compilation).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates bash curl python3 python3-venv python3-dev \
      make g++ ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install uv as a single static binary, pinned by checksum-verified release.
# (Following AGENTS.md CI Supply-Chain Safety: no `curl | sh` of an unpinned
# installer.) uv installs to /usr/local/bin/uv.
ARG UV_VERSION=0.5.11
RUN ARCH=$(uname -m) && \
    case "$ARCH" in \
      x86_64) UV_TARGET="x86_64-unknown-linux-gnu" ;; \
      aarch64) UV_TARGET="aarch64-unknown-linux-gnu" ;; \
      *) echo "unsupported arch $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/uv.tar.gz "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz" && \
    tar -xzf /tmp/uv.tar.gz -C /tmp && \
    mv /tmp/uv-${UV_TARGET}/uv /usr/local/bin/uv && \
    rm -rf /tmp/uv.tar.gz /tmp/uv-${UV_TARGET} && \
    uv --version

# Clone hermes-agent at a pinned release tag and install into a venv at
# /opt/hermes. Skip the `[all]` extra (it pulls Playwright/Chromium + voice
# deps we don't need for a coding TUI).
ARG HERMES_VERSION=v2026.5.16
RUN git clone --depth 1 --branch ${HERMES_VERSION} \
      https://github.com/NousResearch/hermes-agent.git /opt/hermes \
    && cd /opt/hermes \
    && uv venv /opt/hermes/.venv --python 3.11 \
    && . /opt/hermes/.venv/bin/activate \
    && uv pip install -e . \
    && ln -sf /opt/hermes/.venv/bin/hermes /usr/local/bin/hermes

# Vault CA: the vault sidecar MITM-proxies all egress HTTPS to swap
# credential stubs for real values. Bake the CA into the OS trust store so
# git, curl, and Node trust the proxy TLS.
COPY vault/ca.crt /etc/ssl/certs/vault.crt
RUN ln -sf /etc/ssl/certs/vault.crt /usr/local/share/ca-certificates/vault.crt \
    && update-ca-certificates \
    && cat /etc/ssl/certs/vault.crt >> /etc/ssl/certs/ca-certificates.crt \
    && openssl rehash /etc/ssl/certs/

WORKDIR /app
COPY harnesses/hermes/package.json ./
RUN npm install --no-audit --no-fund

COPY harnesses/hermes/server.js ./

COPY harnesses/_shared/entrypoint-common.sh /opt/lap/common.sh
RUN chmod +x /opt/lap/common.sh

COPY harnesses/hermes/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN useradd -m -u 1001 -s /bin/bash sandbox \
    && mkdir -p /work/repo /home/sandbox/.hermes \
    && chown -R sandbox:sandbox /work /app /home/sandbox/.hermes \
    && chown -R sandbox:sandbox /opt/hermes

ENV PORT=4096
ENV REPO_DIR=/work/repo
ENV POC_CMD=hermes
ENV TERM=xterm-256color
ENV HERMES_HOME=/home/sandbox/.hermes

EXPOSE 4096
USER sandbox
WORKDIR /work/repo

ENTRYPOINT ["/entrypoint.sh"]
