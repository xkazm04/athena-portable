# The Proving Ground's trigger page as one container (README §9; ADRs 0037, 0039).
#
# Built from the repository root: `docker build -f proving/serverless/Dockerfile -t athena-proving .`
# The runner, the run modules and Athena-under-test are stdlib-only, so a source tree on PYTHONPATH
# is a complete install: no uv, no pip, no network at build time or at run time beyond Token Factory.
#
# No `claude` CLI is installed, and PROVING_HOSTED=1 says so even if one were: the runner is hosted
# (ADR 0039). It starts only the Gauntlet, with --no-claude --no-control, so no Claude call is made
# at all, and refuses Characters with a reason. Runs recorded where Claude was available
# (Characters, full Gauntlets) are baked in from proving/serverless/seed-runs/ and copied onto the
# volume at start, never over a run already there.
# Not deployed yet; this file is the plan the README walks through.
FROM python:3.12-slim

ENV PYTHONPATH=/opt/athena/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080 \
    PROVING_HOSTED=1 \
    PROVING_RUNS_DIR=/data/proving-runs \
    PROVING_SEED_DIR=/opt/athena/seed-runs
WORKDIR /opt/athena

COPY pyproject.toml README.md /opt/athena/
COPY constitution /opt/athena/constitution
COPY src/athena /opt/athena/src/athena
# The Characters prototype reads its users, journeys and rubric from here (local runs; hosted
# refuses Characters, but the source tree stays whole).
COPY uat/characters /opt/athena/uat/characters
COPY uat/journeys /opt/athena/uat/journeys
COPY uat/rubric.md /opt/athena/uat/rubric.md
# Recorded runs to seed onto the volume (see proving/serverless/seed-runs/README.md).
COPY proving/serverless/seed-runs /opt/athena/seed-runs

# Runs are written here; mount a volume on it to keep them (and the day's spend) across restarts.
RUN mkdir -p /data/proving-runs && useradd --create-home --uid 10001 athena \
    && chown -R athena /data /opt/athena
USER athena
VOLUME ["/data/proving-runs"]
EXPOSE 8080

# Secrets by name only, set on the endpoint: NEBIUS_API_KEY, PROVING_JUDGE_TOKEN.
# Optional: PROVING_DAILY_CAP_NEMOTRON (USD). PROVING_DAILY_CAP_CLAUDE is moot hosted.
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request,os; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8080'), timeout=2)"

CMD ["python", "-m", "athena.proving.server", "--host", "0.0.0.0", "--hosted", "--no-claude", \
     "--env-file", "/nonexistent/.env"]
