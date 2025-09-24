from __future__ import annotations

import base64
import json
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from google.cloud import speech_v1p1beta1 as speech
from google.api_core.exceptions import GoogleAPIError

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
	audio_base64: Optional[str] = None


class AnswerResponse(BaseModel):
	correct: bool
	level: str
	progress_current: int
	progress_total: int
	finished: bool
	feedback: Optional[str] = None
	predicted_level: Optional[str] = None
	item: Optional[SpeakingItem] = None
	pronunciation_score: Optional[float] = None
	pronunciation_feedback: Optional[str] = None


class _SessionState:
	def __init__(self, level_index: int, total: int = 8) -> None:
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


def _dedupe_transcript(text: str) -> str:
	"""Collapse repeated 1–3 word phrases and extra whitespace in transcript."""
	s = re.sub(r"\s+", " ", text or "").strip()
	if not s:
		return s
	patterns = [
		(r"\b(\w+\s+\w+\s+\w+)(?:\s+\1\b)+", r"\1"),
		(r"\b(\w+\s+\w+)(?:\s+\1\b)+", r"\1"),
		(r"\b(\w+)(?:\s+\1\b)+", r"\1"),
	]
	for pat, rep in patterns:
		s = re.sub(pat, rep, s, flags=re.IGNORECASE)
	return re.sub(r"\s+", " ", s).strip()


def _heuristic_estimate_level(transcript: str) -> Dict[str, str]:
	"""Lightweight CEFR estimator (A1–C2) when LLM is unavailable.
	Returns dict with keys: predicted_level, feedback.
	"""
	text = (transcript or "").strip()
	if not text:
		return {"predicted_level": "A1", "feedback": "No transcript detected. Try to speak for 45–60 seconds with clear ideas."}
	# Tokenize words
	words = re.findall(r"[A-Za-z']+", text)
	num_words = len(words)
	unique_words = len(set(w.lower() for w in words)) if words else 0
	type_token_ratio = (unique_words / num_words) if num_words else 0.0
	long_words = [w for w in words if len(w) >= 8]
	long_ratio = (len(long_words) / num_words) if num_words else 0.0
	sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]
	avg_sentence_len = (num_words / len(sentences)) if sentences else num_words
	# Feature counts
	subords = len(re.findall(r"\b(although|though|whereas|while|because|since|unless|until|when|after|before|if)\b", text, re.IGNORECASE))
	relatives = len(re.findall(r"\b(who|which|that|whose|whom)\b", text, re.IGNORECASE))
	modals = len(re.findall(r"\b(would|could|should|might|must|may|can|will|shall)\b", text, re.IGNORECASE))
	perfect = len(re.findall(r"\b(have|has|had)\s+\w+(?:ed|en)\b", text, re.IGNORECASE))
	linkers = len(re.findall(r"\b(however|therefore|moreover|furthermore|in addition|on the other hand|for example|for instance|in conclusion|nevertheless)\b", text, re.IGNORECASE))
	conditionals = len(re.findall(r"\bif\b[\s\S]{0,80}?\b(would|could|might|will|can|had)\b", text, re.IGNORECASE))
	passive = len(re.findall(r"\b(is|are|was|were|be|been|being)\s+\w+ed\b", text, re.IGNORECASE))
	# Scoring
	score = 0
	# Length contribution
	if num_words >= 120:
		score += 6
	elif num_words >= 80:
		score += 5
	elif num_words >= 50:
		score += 4
	elif num_words >= 30:
		score += 3
	elif num_words >= 15:
		score += 2
	else:
		score += 1
	# Grammar/Discourse features
	score += min(4, subords)
	score += min(3, relatives)
	score += min(3, modals)
	score += min(3, perfect)
	score += min(3, linkers)
	score += min(2, conditionals)
	score += min(2, passive)
	# Lexical richness
	if long_ratio > 0.15:
		score += 3
	elif long_ratio > 0.08:
		score += 2
	elif long_ratio > 0.04:
		score += 1
	# Variety
	if type_token_ratio > 0.6:
		score += 2
	elif type_token_ratio > 0.45:
		score += 1
	# Sentence complexity
	if avg_sentence_len >= 20:
		score += 2
	elif avg_sentence_len >= 12:
		score += 1
	# Map score → CEFR
	if score <= 5:
		level = "A1"
	elif score <= 7:
		level = "A2"
	elif score <= 10:
		level = "B1"
	elif score <= 13:
		level = "B2"
	elif score <= 16:
		level = "C1"
	else:
		level = "C2"
	# Feedback suggestions
	suggestions: List[str] = []
	if num_words < 50:
		suggestions.append("Try to speak longer and develop your ideas with examples.")
	if linkers < 1:
		suggestions.append("Use linkers (e.g., however, for example) to connect ideas.")
	if modals < 1:
		suggestions.append("Include modal verbs to express opinions and suggestions.")
	if perfect < 1:
		suggestions.append("Show a wider range of tenses (e.g., present perfect).")
	if avg_sentence_len < 12:
		suggestions.append("Combine clauses to create more complex sentences.")
	if long_ratio < 0.08:
		suggestions.append("Use more topic-specific vocabulary.")
	advice = " ".join(suggestions[:2]) or "Clear and coherent response."
	return {"predicted_level": level, "feedback": advice}


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
	# Limit recording to 60s max
	record_seconds = max(30, min(record_seconds, 60))
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
	# Legacy streak-based adjustment (unused now but kept for compatibility)
	if was_correct:
		state.correct_streak += 1
		state.incorrect_streak = 0
		if state.correct_streak >= 2:
			if state.level_index < len(LEVELS) - 1:
				state.level_index += 1
			state.correct_streak = 0
			state.incorrect_streak = 0
	else:
		state.incorrect_streak += 1
		state.correct_streak = 0
		if state.incorrect_streak >= 2:
			if state.level_index > 0:
				state.level_index -= 1
			state.correct_streak = 0
			state.incorrect_streak = 0


async def _evaluate_transcript(level: str, prompt_text: str, transcript: str) -> Dict[str, Any]:
	"""Ask LLM to assess CEFR A1–C2, and also give relative grade vs target level.
	Returns dict with keys: grade (better|equal|worse), feedback, predicted_level (A1–C2 or None).
	"""
	client_model = "gemini-2.5-flash-lite"
	model = settings.gemini_model_listen or client_model
	client = GeminiClient(model=model)
	try:
		instructions = f"""
You are an expert ESL examiner. Assess the student's CEFR speaking level (A1–C2).

Context: The expected answer was based on a task appropriate for CEFR {level}. Use that as a reference point when comparing performance, but your primary job is to estimate the student's level.

Consider task achievement, range and control of grammar and vocabulary, coherence and fluency. Ignore accent.

Task prompt:
{prompt_text}

Student transcript (verbatim):
{transcript}

Return STRICT JSON only:
{{
  "estimated_level": "A1|A2|B1|B2|C1|C2",
  "grade": "better|equal|worse",
  "feedback": "one or two sentences with concrete advice"
}}
""".strip()
		raw = await client.generate(instructions)
	finally:
		await client.aclose()

	data = _extract_json_block(raw)
	grade = str(data.get("grade", "")).strip().lower()
	predicted = str(data.get("estimated_level", "")).strip().upper()
	if predicted not in LEVELS:
		predicted = None
	if grade not in ("better", "equal", "worse"):
		if predicted in LEVELS:
			try:
				grade = (
					"better"
					if LEVELS.index(predicted) > LEVELS.index(level)
					else "worse" if LEVELS.index(predicted) < LEVELS.index(level) else "equal"
				)
			except Exception:
				grade = "equal"
		else:
			grade = "equal"
	feedback = (data.get("feedback") or "").strip() or None
	return {"grade": grade, "feedback": feedback, "predicted_level": predicted}

def _adjust_level_direct(state: _SessionState, grade: str) -> None:
	if grade == "better" and state.level_index < len(LEVELS) - 1:
		state.level_index += 1
	elif grade == "worse" and state.level_index > 0:
		state.level_index -= 1


async def _assess_pronunciation(audio_base64: str, expected_transcript: str) -> Dict[str, Any]:
	"""Assess pronunciation using Google Cloud Speech-to-Text API.
	Returns dict with keys: pronunciation_score, pronunciation_feedback.
	"""
	if not settings.gemini_vertex_project or not settings.gemini_vertex_region:
		return {"pronunciation_score": None, "pronunciation_feedback": "Pronunciation assessment requires Vertex AI project and region settings."}

	client = speech.SpeechClient()

	audio_content = base64.b64decode(audio_base64)

	diarization_config = speech.SpeakerDiarizationConfig(
		enable_speaker_diarization=False,
		min_speaker_count=1,
		max_speaker_count=1,
	)

	audio = speech.RecognitionAudio(content=audio_content)
	config = speech.RecognitionConfig(
		enable_word_info=True,
		language_code="en-US",
		model="default",
		profanity_filter=True,
		enable_automatic_punctuation=True,
		# Use enhanced for better accuracy with pronunciation assessment
		enhanced=True,
		use_enhanced=True,
		# Enable pronunciation assessment
		enable_spoken_punctuation=True,
		enable_spoken_emojis=True,
		# pronunciation_assessment_config=speech.PronunciationAssessmentConfig(
		# 	reference_text=expected_transcript,
		# 	normalization_mode=speech.PronunciationAssessmentConfig.NormalizationMode.RESPECT_PUNCTUATION,
		# 	scoring_mode=speech.PronunciationAssessmentConfig.ScoringMode.PHONEME_TRAINING,
		# ),
		# speaker_diarization_config=diarization_config,
	)

	try:
		response = client.recognize(config=config, audio=audio)
		# For now, we'll just get the overall confidence as a proxy for pronunciation score
		if response.results:
			# The Speech-to-Text API with pronunciation assessment enabled provides a score
			# in the result.alternatives[0].pronunciation_assessment.overall_score
			# However, the current client library version might not expose it directly in `recognize`
			# For a full pronunciation assessment, `StreamingRecognize` or a more specific client might be needed.
			# For now, we'll use a placeholder or a simpler metric if available.
			# Let's use the confidence of the first alternative as a basic score.
			score = response.results[0].alternatives[0].confidence * 100
			feedback = "Overall pronunciation confidence based on speech recognition."
			return {"pronunciation_score": score, "pronunciation_feedback": feedback}
		else:
			return {"pronunciation_score": None, "pronunciation_feedback": "No speech recognized for pronunciation assessment."}
	except GoogleAPIError as e:
		return {"pronunciation_score": None, "pronunciation_feedback": f"Pronunciation assessment API error: {e}"}
	except Exception as e:
		return {"pronunciation_score": None, "pronunciation_feedback": f"Pronunciation assessment failed: {e}"}


@router.post("/start", response_model=StartResponse)
async def start(req: StartRequest, user: User = Depends(get_current_user)):
	# Force default start at A2 if not provided
	level = (req.start_level or "A2").upper()
	if level not in LEVELS:
		raise HTTPException(status_code=400, detail="start_level must be one of A1,A2,B1,B2,C1,C2")
	# Total of 8 questions per session
	state = _SessionState(level_index=LEVELS.index(level), total=8)
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

	transcript = (req.transcript or "").strip()
	# Sanitize repeated phrases that may occur due to ASR interim/final overlap
	clean_transcript = _dedupe_transcript(transcript)
	predicted_level: Optional[str] = None
	pronunciation_score: Optional[float] = None
	pronunciation_feedback: Optional[str] = None

	if transcript:
		try:
			eval_result = await _evaluate_transcript(item.cefr, item.prompt, clean_transcript)
			grade = eval_result["grade"]
			feedback = eval_result.get("feedback")
			predicted_level = eval_result.get("predicted_level")
			# If model did not provide a valid predicted level, apply heuristic fallback
			if not predicted_level:
				fallback = _heuristic_estimate_level(clean_transcript)
				predicted_level = fallback.get("predicted_level")
				# Prefer model feedback if present, else fallback advice
				if not feedback:
					feedback = fallback.get("feedback")
				# Compute grade from predicted vs target level
				try:
					grade = (
						"better"
						if LEVELS.index(predicted_level) > LEVELS.index(item.cefr)
						else "worse" if LEVELS.index(predicted_level) < LEVELS.index(item.cefr) else "equal"
					)
				except Exception:
					grade = "equal"
		except Exception as e:
			# Full fallback when LLM call fails entirely
			fallback = _heuristic_estimate_level(clean_transcript)
			predicted_level = fallback.get("predicted_level")
			feedback = fallback.get("feedback")
			try:
				grade = (
					"better"
					if LEVELS.index(predicted_level) > LEVELS.index(item.cefr)
					else "worse" if LEVELS.index(predicted_level) < LEVELS.index(item.cefr) else "equal"
				)
			except Exception:
				grade = "equal"
	else:
		feedback = "No transcript received; keeping level the same."

	if audio_base64:
		pron_assessment = await _assess_pronunciation(audio_base64, clean_transcript)
		pronunciation_score = pron_assessment.get("pronunciation_score")
		pronunciation_feedback = pron_assessment.get("pronunciation_feedback")

	state.history.append(
		{
			"item_id": item.id,
			"grade": grade,
			"level": item.cefr,
			"transcript": clean_transcript[:4000],
			"feedback": feedback,
			"pronunciation_score": pronunciation_score,
			"pronunciation_feedback": pronunciation_feedback,
		}
	)

	_adjust_level_direct(state, grade)

	finished = state.asked >= state.total

	response = AnswerResponse(
		correct=(grade == "better"),
		level=LEVELS[state.level_index],
		progress_current=state.asked,
		progress_total=state.total,
		finished=finished,
		feedback=feedback,
		predicted_level=predicted_level,
		item=item if not finished else None,
		pronunciation_score=pronunciation_score,
		pronunciation_feedback=pronunciation_feedback,
	)

	if finished:
		try:
			del _sessions[state.session_id]
		except KeyError:
			pass

	return response


class NextRequest(BaseModel):
	session_id: str


@router.post("/next", response_model=StartResponse)
async def next_item(req: NextRequest, user: User = Depends(get_current_user)):
	state = _sessions.get(req.session_id)
	if not state:
		raise HTTPException(status_code=404, detail="Session not found or expired")
	# If all items already asked (user answered the last one), there is no next
	if state.asked >= state.total:
		raise HTTPException(status_code=400, detail="Session finished")
	item = await _generate_item_for(state.level_index)
	state.items[item.id] = item
	state.asked += 1
	return StartResponse(
		session_id=state.session_id,
		item=item,
		progress_current=state.asked,
		progress_total=state.total,
		level=LEVELS[state.level_index],
	)
