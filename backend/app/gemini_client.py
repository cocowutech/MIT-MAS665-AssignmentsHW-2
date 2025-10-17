from __future__ import annotations
import httpx
from typing import Any, Dict, List, Optional
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
		self._fallback_client: Optional[httpx.AsyncClient] = None
		self._fallback_enabled = bool(settings.openrouter_api_key)
		self._openrouter_api_key = settings.openrouter_api_key
		self._openrouter_model = settings.openrouter_model
		self._openrouter_base_url = settings.openrouter_base_url
		self._openrouter_headers = {
			"Authorization": f"Bearer {self._openrouter_api_key}" if self._openrouter_api_key else "",
			"Content-Type": "application/json",
			"HTTP-Referer": settings.openrouter_referer,
			"X-Title": settings.openrouter_title,
		}
		if self._fallback_enabled:
			self._fallback_client = httpx.AsyncClient(timeout=30)

	async def generate(self, prompt: str, *, thinking_budget: Optional[int] = None) -> str:
		payload: Dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
		return await self._post_payload(
			payload,
			thinking_budget=thinking_budget,
			fallback_prompt=prompt,
		)

	async def generate_multimodal(
		self,
		parts: List[Dict[str, Any]],
		*,
		role: str = "user",
		thinking_budget: Optional[int] = None,
		allow_fallback: bool = False,
	) -> str:
		payload: Dict[str, Any] = {"contents": [{"role": role, "parts": parts}]}
		return await self._post_payload(
			payload,
			thinking_budget=thinking_budget,
			fallback_prompt=None,
			allow_fallback=allow_fallback,
		)

	async def _post_payload(
		self,
		payload: Dict[str, Any],
		*,
		thinking_budget: Optional[int] = None,
		fallback_prompt: Optional[str],
		allow_fallback: bool = True,
	) -> str:
		params: Dict[str, Any] = {}
		headers: Dict[str, str] = {}
		if self._auth_in_query:
			params["key"] = self.api_key
		else:
			headers["x-goog-api-key"] = self.api_key
		if thinking_budget is not None:
			try:
				budget_tokens = int(thinking_budget)
			except Exception:
				budget_tokens = 0
			payload = {**payload, "thinkingConfig": {"budgetTokens": budget_tokens}}
		last_error: Optional[Exception] = None
		try:
			r = await self._client.post(self.base_url, params=params, headers=headers, json=payload)
			r.raise_for_status()
		except httpx.HTTPStatusError as http_err:
			if thinking_budget is not None and "thinkingConfig" in payload:
				fallback_payload = dict(payload)
				fallback_payload.pop("thinkingConfig", None)
				try:
					r = await self._client.post(self.base_url, params=params, headers=headers, json=fallback_payload)
					r.raise_for_status()
				except Exception as err:
					last_error = err
			else:
				last_error = http_err
		except httpx.RequestError as net_err:
			last_error = net_err
		if last_error is None:
			try:
				data = r.json()
				return data["candidates"][0]["content"]["parts"][0]["text"]
			except Exception:
				last_error = RuntimeError(f"Unexpected Gemini response: {r.text}")
		if not allow_fallback or not self._fallback_enabled:
			raise last_error or RuntimeError("Gemini call failed and no fallback configured")
		if fallback_prompt is None:
			raise last_error or RuntimeError("Gemini call failed and fallback prompt unavailable")
		return await self._fallback_generate(fallback_prompt, last_error)

	async def aclose(self) -> None:
		await self._client.aclose()
		if self._fallback_client is not None:
			await self._fallback_client.aclose()

	async def _fallback_generate(self, prompt: str, primary_error: Optional[Exception]) -> str:
		if not self._fallback_client or not self._openrouter_api_key:
			raise primary_error or RuntimeError("Fallback requested but OpenRouter is not configured")
		headers = {k: v for k, v in self._openrouter_headers.items() if v}
		payload: Dict[str, Any] = {
			"model": self._openrouter_model,
			"messages": [{"role": "user", "content": prompt}],
		}
		try:
			r = await self._fallback_client.post(
				self._openrouter_base_url,
				headers=headers,
				json=payload,
			)
			r.raise_for_status()
			data = r.json()
			return data["choices"][0]["message"]["content"]
		except Exception as fallback_err:
			if primary_error is not None:
				raise RuntimeError(
					f"Gemini primary call failed ({primary_error}); fallback via OpenRouter also failed"
				) from fallback_err
			raise fallback_err
