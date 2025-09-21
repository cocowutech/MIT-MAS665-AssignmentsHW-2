from __future__ import annotations
import httpx
from typing import Any, Dict, Optional
from .settings import settings

class GeminiClient:
	def __init__(self, api_key: Optional[str] = None, *, base_url: Optional[str] = None, model: Optional[str] = None) -> None:
		self.api_key = api_key or settings.gemini_api_key
		if not self.api_key:
			raise ValueError("GEMINI_API_KEY is not configured")
		self.model = model or settings.gemini_model
		self.provider = settings.gemini_provider
		if self.provider == "vertex":
			region = settings.vertex_region
			project = settings.vertex_project or "placeholder-project"
			# Vertex AI Generative REST endpoint (API key via header)
			self.base_url = base_url or (
				f"https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{self.model}:generateContent"
			)
			self._auth_in_query = False
		else:
			# Google AI Studio (Generative Language API)
			self.base_url = base_url or f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
			self._auth_in_query = True
		self._client = httpx.AsyncClient(timeout=30)

	async def generate(self, prompt: str) -> str:
		params: Dict[str, Any] = {}
		headers: Dict[str, str] = {}
		if self._auth_in_query:
			params["key"] = self.api_key
		else:
			headers["x-goog-api-key"] = self.api_key
		payload: Dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
		r = await self._client.post(self.base_url, params=params, headers=headers, json=payload)
		r.raise_for_status()
		data = r.json()
		try:
			return data["candidates"][0]["content"]["parts"][0]["text"]
		except Exception as e:
			raise RuntimeError(f"Unexpected Gemini response: {data}") from e

	async def aclose(self) -> None:
		await self._client.aclose()
