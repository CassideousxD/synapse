import type { ModelTier } from "../types";

export const MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "nvidia/nemotron-3-super-120b-a12b", // TODO: revert to nemotron-3.5-lightning-30b-a3b once it responds reliably
  main: "nvidia/nemotron-3-super-120b-a12b",
  heavy: "nvidia/nemotron-3-ultra-550b-a55b",
};

export function resolveModel(tier: ModelTier): string {
  return MODEL_BY_TIER[tier];
}
