# The Proving Ground's trigger page as one container (README §9; ADR 0037).
#
# Built from the repository root: `docker build -f proving/serverless/Dockerfile -t athena-proving .`
# The runner, the run modules and Athena-under-test are stdlib-only, so a source tree on PYTHONPATH
# is a complete install: no uv, no pip, no network at build time or at run time beyond Token Factory.
#
# No `claude` CLI is installed: the image runs `--no-claude`, so only the Athena-on-Nemotron row is
# live, and the Haiku control's calls fail and are ledgered as such (proving/serverless/README.md).
# Not deployed yet; this file is the plan the README walks through.
FROM python:3.12-slim

ENV PYTHONPATH=/opt/athena/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080
WORKDIR /opt/athena

COPY pyproject.toml README.md /opt/athena/
COPY constitution /opt/athena/constitution
COPY src/athena /opt/athena/src/athena
# The Characters prototype reads its users, journeys and rubric from here.
COPY uat/characters /opt/athena/uat/characters
COPY uat/journeys /opt/athena/uat/journeys
COPY uat/rubric.md /opt/athena/uat/rubric.md

# Runs are written here; mount a volume on it to keep them (and the day's spend) across restarts.
RUN mkdir -p /data/proving-runs && useradd --create-home --uid 10001 athena \
    && chown -R athena /data /opt/athena
USER athena
VOLUME ["/data/proving-runs"]
EXPOSE 8080

# Secrets by name only, set on the endpoint: NEBIUS_API_KEY, PROVING_JUDGE_TOKEN.
# Optional: PROVING_DAILY_CAP_NEMOTRON, PROVING_DAILY_CAP_CLAUDE (USD).
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8080'), timeout=2)"

CMD ["python", "-m", "athena.proving.server", "--host", "0.0.0.0", "--no-claude", \
     "--out", "/data/proving-runs", "--env-file", "/nonexistent/.env"]
