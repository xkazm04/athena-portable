"""Two commands run through the lock at once must not overlap."""

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).parent


def test_two_holders_serialise():
    with tempfile.TemporaryDirectory() as home:
        env = {**os.environ, "ATHENA_AVATAR_HOME": home}
        log = Path(home) / "log.txt"
        child = (
            "import time,sys;"
            f"open(r'{log}','a').write('start\\n');time.sleep(1.5);"
            f"open(r'{log}','a').write('end\\n')"
        )
        procs = [
            subprocess.Popen(
                [sys.executable, str(HERE / "gpulock.py"), "--label", f"t{i}", "--", sys.executable, "-c", child],
                env=env,
            )
            for i in range(2)
        ]
        t0 = time.monotonic()
        assert all(p.wait(timeout=30) == 0 for p in procs)
        assert time.monotonic() - t0 >= 3.0
        assert log.read_text().split() == ["start", "end", "start", "end"]
