from __future__ import annotations


class LLMProviderError(Exception):
    """Base error for all LLM provider failures."""

    def __init__(self, message: str, status: int | None = None, provider: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.provider = provider


class AuthenticationError(LLMProviderError):
    """Raised when provider credentials/API keys are invalid or missing."""
    pass


class RateLimitError(LLMProviderError):
    """Raised when provider returns a rate limit (HTTP 429)."""
    pass


class TimeoutError(LLMProviderError):
    """Raised when provider request times out."""
    pass


class TemporaryProviderError(LLMProviderError):
    """Raised on transient provider issues (HTTP 502, 503, 504, connection drops)."""
    pass


class InvalidResponseError(LLMProviderError):
    """Raised when provider reply is malformed or missing expected content."""
    pass


class ConfigurationError(LLMProviderError):
    """Raised when an invalid or unsupported provider is requested."""
    pass


# Backward compatibility alias for legacy code
NimError = LLMProviderError
