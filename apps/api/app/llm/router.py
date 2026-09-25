from typing import Literal

ModelTier = Literal["fast", "main", "heavy"]

# Mirrors packages/llm-client/src/routing/model-router.ts exactly — one source
# of truth for the tier->model mapping is TS-side; keep this in sync by hand
# until/unless we promote it into a shared JSON config both sides read.
MODEL_BY_TIER: dict[ModelTier, str] = {
    "fast": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "main": "nvidia/nemotron-3-super-120b-a12b",
    "heavy": "nvidia/nemotron-3-ultra-550b-a55b",
}


def resolve_model(tier: ModelTier) -> str:
    return MODEL_BY_TIER[tier]
