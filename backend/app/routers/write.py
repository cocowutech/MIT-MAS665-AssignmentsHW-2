from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Any, Dict, Optional
from ..gemini_client import GeminiClient
from .auth import get_current_user, User
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import ReadModule

try:
	import pytesseract  # type: ignore
	from PIL import Image  # type: ignore
except Exception:
	# Defer import errors until the OCR endpoint is actually called
	pytesseract = None  # type: ignore
	Image = None  # type: ignore


router = APIRouter(prefix="/write", tags=["writing"])


CEFR_BANDS = ["A1", "A2", "B1", "B2", "C1", "C2"]


class GeneratePromptRequest(BaseModel):
	# Kept for backward compatibility; values (if any) are ignored.
	band: Optional[str] = None
	topic: Optional[str] = None


class GeneratePromptResponse(BaseModel):
	prompt: str


class ScoreTextRequest(BaseModel):
	text: str


def _map_band_to_exam(band: str) -> str:
	# Deprecated: kept only to avoid accidental import errors elsewhere
	band = (band or "B1").upper()
	if band in ("A1", "A2"):
		return "KET"
	if band == "B1":
		return "PET"
	return "FCE"


_CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]

def _average_band(levels: list[str]) -> str:
	if not levels:
		return "B1"
	idxs = [max(0, min(_CEFR_ORDER.index(l) if l in _CEFR_ORDER else 2, len(_CEFR_ORDER)-1)) for l in levels]
	avg = round(sum(idxs) / len(idxs))
	return _CEFR_ORDER[avg]


def _build_prompt_generation_prompt() -> str:
	return (
		"You are an English assessment content writer. Generate ONE writing prompt on a random, everyday topic.\n"
		"Requirements: the prompt must ask the user to write approximately 200 words.\n"
		"Keep it neutral and broadly relevant (no cultural bias).\n\n"
		"Return ONLY a compact JSON object with exactly one key: prompt (string)."
	)


def _build_scoring_prompt(text: str) -> str:
	return (
		"You are an English writing examiner. Read the student's text and estimate an overall CEFR band (A1–C2) based on holistic evidence.\n"
		"Assess the writing considering (not limited to):\n"
		"- vocabulary_complexity (range and appropriacy of lexis)\n"
		"- grammar_complexity (variety of structures)\n"
		"- verb_patterns (gerunds/infinitives after common verbs)\n"
		"- comparatives_superlatives\n"
		"- sequencing_words (linkers like first, then, finally, however, therefore)\n"
		"- opinions_and_reasons (clear stance and justification)\n"
		"- coherence_cohesion (paragraphing, flow, referencing)\n"
		"- accuracy (grammar/spelling/punctuation)\n"
		"- task_response (relevance, completeness)\n\n"
		"Scoring: give each dimension a score from 0–5 (half points allowed). Compute overall as the simple average of the provided dimensions.\n"
		"Also provide a word_count, a short global comment, and optional inline comments as an array of {span, comment}.\n\n"
		"Return ONLY a JSON object with keys: band (A1–C2), scores (object with the dimensions above), overall (number), word_count (integer), comments (object with global string, inline array of objects with span and comment).\n\n"
		f"Student writing:\n{text}"
	)


@router.post("/prompt", response_model=GeneratePromptResponse)
async def generate_prompt(req: GeneratePromptRequest, user: User = Depends(get_current_user)):
	client = GeminiClient(model="gemini-2.5-flash-lite")
	try:
		prompt_text = _build_prompt_generation_prompt()
		text = await client.generate(prompt_text)
		# Expecting JSON; do a light parse and fallback
		import json
		try:
			data = json.loads(text)
			prompt_value = str(data.get("prompt", "")).strip()
		except Exception:
			# Fallback: use raw text as prompt
			prompt_value = text.strip()
		if not prompt_value:
			prompt_value = "Write approximately 200 words on a random topic of everyday life (e.g., a memorable journey, a challenge you faced, or a hobby you enjoy)."
		return GeneratePromptResponse(prompt=prompt_value)
	finally:
		await client.aclose()


@router.get("/default_band")
async def default_band(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	levels: list[str] = []
	try:
		rm = db.get(ReadModule, user.username)
		if rm and rm.end_cefr:
			levels.append(str(rm.end_cefr))
	except Exception:
		pass
	band = _average_band(levels)
	return {"band": band}


@router.post("/score/text")
async def score_text(req: ScoreTextRequest, user: User = Depends(get_current_user)):
	text = (req.text or "").strip()
	if not text:
		raise HTTPException(status_code=400, detail="text is required")
	# Optional safety clamp to avoid extremely long prompts
	if len(text) > 8000:
		text = text[:8000]
	client = GeminiClient(model="gemini-2.5-flash-lite")
	try:
		prompt = _build_scoring_prompt(text)
		model_out = await client.generate(prompt)
		import json
		try:
			data = json.loads(model_out)
		except Exception:
			# Return raw text if JSON parsing fails
			return {"raw": model_out}
		return data
	finally:
		await client.aclose()


@router.post("/score/image")
async def score_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
	if pytesseract is None or Image is None:
		raise HTTPException(
			status_code=500,
			detail="OCR dependencies not installed. Install system package 'tesseract-ocr' and Python packages 'pytesseract' and 'Pillow'",
		)
	try:
		content = await file.read()
		from io import BytesIO
		img = Image.open(BytesIO(content))
		text = pytesseract.image_to_string(img)
	except Exception as e:
		raise HTTPException(status_code=400, detail=f"Failed to OCR image: {e}")
	# Reuse text scoring
	return await score_text(ScoreTextRequest(text=text), user)


