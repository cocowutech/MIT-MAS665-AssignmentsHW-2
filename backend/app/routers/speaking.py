from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..gemini_client import GeminiClient
from ..settings import settings
from .auth import User, get_current_user


router = APIRouter(prefix="/speaking", tags=["speaking"])


LEVELS: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]


def level_to_exam(level: str) -> str:
	# Map CEFR to Cambridge target focus (KET/PET/FCE). For C1/C2, use FCE-style targets.
	if level in ("A1", "A2"):
		return "KET"
	if level == "B1":
		return "PET"
	return "FCE"


class SpeakingItem(BaseModel):
	id: str
	cefr: str
	exam_target: str
	prompt: str
	prep_seconds: int = Field(ge=0, le=90)
	record_seconds: int = Field(ge=10, le=180)
	guidance: Optional[str] = None


class StartRequest(BaseModel):
	start_level: Optional[str] = Field(default=None, description="Initial CEFR level A1–C2 (default A2)")


class StartResponse(BaseModel):
	session_id: str
	item: SpeakingItem
	progress_current: int
	progress_total: int
	level: str


class AnswerRequest(BaseModel):
	session_id: str
	item_id: str
	# Client should POST recorded audio as base64 or URL in future; for MVP we accept self-score bool
	was_correct: Optional[bool] = None
	# Optional ASR transcript (future). Not required for this MVP.
	transcript: Optional[str] = None


class AnswerResponse(BaseModel):
	correct: bool
	level: str
	progress_current: int
	progress_total: int
	finished: bool
	feedback: Optional[str] = None
	item: Optional[SpeakingItem] = None


class _SessionState:
	def __init__(self, level_index: int, total: int = 15) -> None:
		self.session_id: str = uuid.uuid4().hex
		self.level_index: int = level_index
		self.correct_streak: int = 0
		self.incorrect_streak: int = 0
		self.asked: int = 0
		self.total: int = total
		self.items: Dict[str, SpeakingItem] = {}
		self.history: List[Dict[str, Any]] = []


_sessions: Dict[str, _SessionState] = {}


def _extract_json_block(text: str) -> Dict[str, Any]:
	try:
		return json.loads(text)
	except Exception:
		pass
	# Try to locate the first JSON object in the text
	match = re.search(r"\{[\s\S]*\}", text)
	if match:
		candidate = match.group(0)
		try:
			return json.loads(candidate)
		except Exception:
			pass
	raise ValueError("Failed to parse JSON from Gemini output")


def _build_prompt_for(level: str) -> str:
	exam = level_to_exam(level)
	return f"""
You are an ESL speaking task writer.

Generate ONE short speaking prompt aligned to CEFR {level}. Map to Cambridge {exam} targets.

Constraints:
- 30s preparation + 60s speaking time by default (allowable in JSON as prep_seconds and record_seconds).
- Use everyday, age-neutral topics; avoid culture-specific references.
- Prompt type can be: personal experience, picture description (no image provided), short opinion with two reasons, role-play cue, or explain a process.
- Include concise guidance on what good answers should include (task achievement, lexis/structures typical for {level}/{exam}).

Return STRICT JSON only, no markdown, following exactly this schema:
{{
  "prompt": string,
  "prep_seconds": integer (e.g., 30),
  "record_seconds": integer (e.g., 60),
  "guidance": string
}}
""".strip()


async def _generate_item_for(level_index: int) -> SpeakingItem:
	level = LEVELS[level_index]
	client_model = "gemini-2.5-flash-lite"
	# Allow env override but default to 2.5 flash-lite per user request
	model = settings.gemini_model_listen or client_model
	client = GeminiClient(model=model)
	try:
		prompt = _build_prompt_for(level)
		raw = await client.generate(prompt)
	finally:
		await client.aclose()

	data = _extract_json_block(raw)
	prompt_text = str(data.get("prompt", "")).strip()
	prep_seconds = int(data.get("prep_seconds", 30))
	record_seconds = int(data.get("record_seconds", 60))
	guidance = (data.get("guidance") or "").strip() or None
	if not prompt_text:
		raise HTTPException(status_code=502, detail="Gemini returned empty prompt")
	# Clamp seconds to safe ranges
	prep_seconds = max(10, min(prep_seconds, 90))
	record_seconds = max(30, min(record_seconds, 180))
	return SpeakingItem(
		id=uuid.uuid4().hex,
		cefr=level,
		exam_target=level_to_exam(level),
		prompt=prompt_text,
		prep_seconds=prep_seconds,
		record_seconds=record_seconds,
		guidance=guidance,
	)


def _adjust_level(state: _SessionState, was_correct: bool) -> None:
	if was_correct:
		state.correct_streak += 1
		state.incorrect_streak = 0
		if state.correct_streak >= 2:
			# Increase difficulty or keep at C2, then reset streaks
			if state.level_index < len(LEVELS) - 1:
				state.level_index += 1
			state.correct_streak = 0
			state.incorrect_streak = 0
	else:
		state.incorrect_streak += 1
		state.correct_streak = 0
		if state.incorrect_streak >= 2:
			# Decrease difficulty or keep at A1, then reset streaks
			if state.level_index > 0:
				state.level_index -= 1
			state.correct_streak = 0
			state.incorrect_streak = 0


@router.post("/start", response_model=StartResponse)
async def start(req: StartRequest, user: User = Depends(get_current_user)):
	# Force default start at A2 if not provided
	level = (req.start_level or "A2").upper()
	if level not in LEVELS:
		raise HTTPException(status_code=400, detail="start_level must be one of A1,A2,B1,B2,C1,C2")
	state = _SessionState(level_index=LEVELS.index(level), total=15)
	_sessions[state.session_id] = state

	item = await _generate_item_for(state.level_index)
	state.items[item.id] = item
	state.asked = 1

	return StartResponse(
		session_id=state.session_id,
		item=item,
		progress_current=state.asked,
		progress_total=state.total,
		level=LEVELS[state.level_index],
	)


@router.post("/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest, user: User = Depends(get_current_user)):
	state = _sessions.get(req.session_id)
	if not state:
		raise HTTPException(status_code=404, detail="Session not found or expired")
	item = state.items.get(req.item_id)
	if not item:
		raise HTTPException(status_code=400, detail="Unknown item_id for this session")

	# For MVP, we use was_correct flag from client to drive adaptation.
	was_correct = bool(req.was_correct)
	state.history.append(
		{
			"item_id": item.id,
			"was_correct": was_correct,
			"level": item.cefr,
			"transcript": (req.transcript or "")[:4000],
		}
	)

	_adjust_level(state, was_correct)

	finished = state.asked >= state.total
	next_item: Optional[SpeakingItem] = None
	if not finished:
		next_item = await _generate_item_for(state.level_index)
		state.items[next_item.id] = next_item
		state.asked += 1

	response = AnswerResponse(
		correct=was_correct,
		level=LEVELS[state.level_index],
		progress_current=state.asked,
		progress_total=state.total,
		finished=finished,
		feedback=None,
		item=next_item,
	)

	if finished:
		try:
			del _sessions[state.session_id]
		except KeyError:
			pass

	return response


