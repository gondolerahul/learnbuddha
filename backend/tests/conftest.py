import os
import shutil
import tempfile

# Configure before the app is imported.
_media = tempfile.mkdtemp(prefix="lb-media-")
os.environ.update({
    "LB_TEST_DATABASE_URL": os.environ.get("LB_TEST_DATABASE_URL", "postgresql+psycopg://learnbuddha@localhost:5433/learnbuddha_test"),
    "BRAIN_PROVIDER": "mock",
    "TTS_PROVIDER": "silent",
    "VOICE_PROVIDER": "text",
    "MEDIA_DIR": _media,
    "RUN_WORKER_IN_PROCESS": "false",
    "RENDER_WIDTH": "640",
    "RENDER_HEIGHT": "360",
    "RENDER_FPS": "15",
    "ANTHROPIC_API_KEY": "",
    "GEMINI_API_KEY": "",
    "GOOGLE_CLOUD_PROJECT": "",  # tests never call Vertex AI, even when backend/.env sets a project
    "USD_INR": "90",  # fixed rate: no exchange-rate lookups from tests
    "FX_LIVE": "false",
})

import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import Base, engine, init_db  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def fresh_db():
    init_db()
    with engine().begin() as conn:
        for t in reversed(Base.metadata.sorted_tables):
            conn.execute(text(f'TRUNCATE "{t.name}" CASCADE'))
    yield
    shutil.rmtree(_media, ignore_errors=True)
