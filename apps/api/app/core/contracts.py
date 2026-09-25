import sys
from pathlib import Path

_GENERATED_PY = Path(__file__).resolve().parents[4] / "contracts" / "generated" / "py"
if str(_GENERATED_PY) not in sys.path:
    sys.path.insert(0, str(_GENERATED_PY))

from analysis_payload_schema import AnalysisPayload  # noqa: E402

__all__ = ["AnalysisPayload"]
