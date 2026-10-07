# The world image (README §9, ADR 0033)

One image for a Proving Ground world on Token Factory Sandboxes: Python 3.12 with this repo's
daemon on `PYTHONPATH`, Node and headless Chromium from the Playwright base, and the `ledgerbox`
example app built.

The spike (`python -m athena.proving.sandbox spike`) does not need this image. It imports the
same public base and installs the same things in a recorded run, so it needs no registry of
ours. Use the Dockerfile when the spike has passed and worlds are built for real:

```bash
contree build -f proving/image/Dockerfile .   # Sandboxes builds it, layer by layer
docker build -f proving/image/Dockerfile .    # or check it locally
```

Sandboxes drops `CMD` and `ENTRYPOINT` (it imports the root filesystem and `ENV` only), and
`contree build` does not run multi-stage builds, so this file has one stage and no entrypoint.
