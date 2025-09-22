from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
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
	band: Optional[str] = None
	topic: Optional[str] = None


class GeneratePromptResponse(BaseModel):
	prompt: str
	band: str
	exam_task: str
	targets: Dict[str, Any]


class ScoreTextRequest(BaseModel):
	text: str
	band_hint: Optional[str] = None


def _map_band_to_exam(band: str) -> str:
	band = band.upper()
	if band in ("A1", "A2"):
		return "KET"
	if band == "B1":
		return "PET"
	# For B2 and C1, map to FCE with stretch targets for C1
	return "FCE"


_CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]

def _average_band(levels: list[str]) -> str:
	if not levels:
		return "B1"
	idxs = [max(0, min(_CEFR_ORDER.index(l) if l in _CEFR_ORDER else 2, len(_CEFR_ORDER)-1)) for l in levels]
	avg = round(sum(idxs) / len(idxs))
	return _CEFR_ORDER[avg]


def _build_prompt_generation_prompt(band: str, topic: Optional[str]) -> str:
	band = band.upper()
	exam = _map_band_to_exam(band)
	topic_part = f"Topic focus: {topic}." if topic else ""
	return (
		"You are an English assessment content writer. Generate ONE short writing prompt aligned to the given CEFR band.\n"
		"Constraints: clear task, real-world context, word count guidance, avoid cultural bias.\n"
		"Also map the prompt to the exam task type for KET/PET/FCE and list target vocabulary/structures appropriate for the band.\n\n"
		f"Band: {band} (map to exam: {exam}). {topic_part}\n\n"
		"Return ONLY a compact JSON object with keys: prompt (string), band (string), exam_task (string), targets (object with fields target_vocab [array of strings], target_structures [array of strings])."
	)


def _build_scoring_prompt(text: str, band_hint: Optional[str]) -> str:
	band_hint = (band_hint or "B1").upper()
	exam = _map_band_to_exam(band_hint)
	return (
		"You are an English writing examiner. Score the student writing using a CEFR-aligned rubric.\n"
		"Rubric dimensions (0–5 each, half-points allowed):\n"
		"- content (task response, relevance)\n"
		"- organization (coherence, cohesion, paragraphing, discourse markers)\n"
		"- language_control (grammar accuracy, spelling, punctuation)\n"
		"- range (lexical variety, grammar range appropriate to band)\n\n"
		f"Assumed target band: {band_hint} (exam mapping: {exam}).\n"
		"Provide: band estimate (A2–C1), exam_mapping (exam: KET/PET/FCE, target_vocab, target_structures), per-dimension scores, overall (average), word_count, comments (global + inline array of {span, comment}).\n"
		"If off-topic or too short (<40 words), reflect that in content score and comments.\n\n"
		"Return ONLY a JSON object with keys: band, exam_mapping (object with exam, target_vocab [array], target_structures [array]), scores (object with content, organization, language_control, range), overall (number), word_count (integer), comments (object with global string, inline array of objects with span and comment).\n\n"
		f"Student writing:\n{text}"
	)


@router.post("/prompt", response_model=GeneratePromptResponse)
async def generate_prompt(req: GeneratePromptRequest, user: User = Depends(get_current_user)):
	band = (req.band or "B1").upper()
	if band not in CEFR_BANDS:
		raise HTTPException(status_code=400, detail=f"band must be one of {CEFR_BANDS}")
	client = GeminiClient(model="gemini-2.5-flash-lite")
	try:
		prompt = _build_prompt_generation_prompt(band, req.topic)
		text = await client.generate(prompt)
		# Expecting JSON; do a light parse and fallback
		import json
		try:
			data = json.loads(text)
		except Exception:
			# Fallback: wrap in expected structure
			data = {
				"prompt": text.strip(),
				"band": band,
				"exam_task": "task",
				"targets": {"target_vocab": [], "target_structures": []},
			}
		# Validate minimally
		return GeneratePromptResponse(
			prompt=data.get("prompt", ""),
			band=data.get("band", band),
			exam_task=data.get("exam_task", "task"),
			targets=data.get("targets", {"target_vocab": [], "target_structures": []}),
		)
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
		prompt = _build_scoring_prompt(text, req.band_hint)
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
	band_hint: Optional[str] = Form(default=None),
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
	return await score_text(ScoreTextRequest(text=text, band_hint=band_hint), user)


