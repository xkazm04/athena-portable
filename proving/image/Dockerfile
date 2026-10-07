# The Proving Ground's world image for Token Factory Sandboxes (README §9; ADR 0033).
#
# Built from the repository root with `contree build -f proving/image/Dockerfile .`, or with
# `docker build` for a local check. Sandboxes imports only the root filesystem and ENV: CMD and
# ENTRYPOINT are dropped, so nothing here starts the daemon; every run starts its own.
#
# The base ships Node (v24.20.0 at this tag) and Chromium (/ms-playwright/chromium-1243), and its
# Ubuntu noble has python3 3.12.3 — verified locally with `docker run` on 2026-10-07. The daemon
# is stdlib-only, so a source tree on PYTHONPATH is a complete install: no uv, no pip, no network.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV PYTHONPATH=/opt/athena/src
WORKDIR /opt/athena

COPY pyproject.toml README.md /opt/athena/
COPY constitution /opt/athena/constitution
COPY src/athena /opt/athena/src/athena

# One example Next app (examples/ledgerbox) with the kit it imports. Needs the network at build
# time; drop these lines for a daemon-only image.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /opt/athena/
COPY examples/demo-kit /opt/athena/examples/demo-kit
COPY examples/ledgerbox /opt/athena/examples/ledgerbox
RUN corepack enable && pnpm install --filter 'ledgerbox...' --no-frozen-lockfile \
    && pnpm --filter ledgerbox build

RUN python3 -c "import athena, sys; print('athena', athena.__version__, 'python', sys.version)" \
    && node --version && ls -d /ms-playwright/chromium-*
