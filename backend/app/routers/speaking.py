"""
Speaking Assessment Module
==========================

This module provides adaptive speaking assessment functionality for the English
placement test. It generates speaking tasks at appropriate CEFR levels, evaluates
student responses using LLM-based assessment, and adjusts difficulty dynamically.

Key Features:
- Adaptive difficulty adjustment based on performance
- LLM-powered evaluation with heuristic fallback
- Pronunciation assessment using Google Cloud Speech-to-Text
- Cambridge exam alignment (KET/PET/FCE)
- Session management with progress tracking

The module uses a hybrid approach combining:
1. LLM-based evaluation for sophisticated assessment
2. Heuristic analysis as fallback for reliability
3. Pronunciation scoring via speech recognition confidence

API Endpoints:
- POST /speaking/start: Begin new assessment session
- POST /speaking/answer: Submit speaking response for evaluation
- POST /speaking/next: Get next task in current session

Author: ESL Assessment System
Version: 1.0
"""

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

# ============================================================================
# CONSTANTS AND CONFIGURATION
# ============================================================================

# CEFR levels supported by the speaking assessment
LEVELS: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Global session storage - Might not be relevant anymore (consider using Redis or database for production)
_sessions: Dict[str, Dict[str, Any]] = {}


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def level_to_exam(level: str) -> str:
	"""
	Map CEFR levels to Cambridge exam targets.
	
	This function provides alignment between CEFR levels and Cambridge English
	examinations for better assessment context and reporting.
	
	Args:
		level: CEFR level (A1, A2, B1, B2, C1, C2)
		
	Returns:
		Cambridge exam target: "KET" for A1/A2, "PET" for B1, "FCE" for B2/C1/C2
	"""
	if level in ("A1", "A2"):
		return "KET"
	if level == "B1":
		return "PET"
	return "FCE"


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class SpeakingItem(BaseModel):
	"""
	Speaking task item model.
	
	Represents a single speaking task with its prompt, instructions,
	and timing requirements.
	"""
	id: str
	cefr: str
	exam_target: str
	prompt: str
	prep_seconds: int = Field(ge=0, le=90)
	record_seconds: int = Field(ge=10, le=180)
	guidance: Optional[str] = None


class StartRequest(BaseModel):
	"""
	Request model for starting a new speaking session.
	"""
	start_level: Optional[str] = Field(default=None, description="Initial CEFR level A1–C2 (default A2)")


class StartResponse(BaseModel):
	"""
	Response model for session start containing first task.
	"""
	session_id: str
	item: SpeakingItem
	progress_current: int
	progress_total: int
	level: str


class AnswerRequest(BaseModel):
	"""
	Request model for submitting speaking answers.
	
	Note: Client should POST recorded audio as base64 or URL in future; 
	for MVP we accept self-score bool.
	"""
	session_id: str
	item_id: str
	# Client should POST recorded audio as base64 or URL in future; for MVP we accept self-score bool
	was_correct: Optional[bool] = None
	# Optional ASR transcript (future). Not required for this MVP.
	transcript: Optional[str] = None
	audio_base64: Optional[str] = None


class AnswerResponse(BaseModel):
	"""
	Response model for speaking answer evaluation.
	"""
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
	overall_score: Optional[float] = None
	audio_feedback: Optional[str] = None
	audio_scores: Optional[Dict[str, float]] = None
	accent_label: Optional[str] = None
	accent_confidence: Optional[float] = None


# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

class _SessionState:
	"""
	Internal session state for tracking speaking assessment progress.
	
	Manages the adaptive assessment session including current difficulty level,
	progress tracking, and performance history. Used internally by the speaking
	module to maintain session state between API calls.
	
	Attributes:
		session_id: Unique identifier for the session
		level_index: Current CEFR level index (0=A1, 1=A2, etc.)
		correct_streak: Legacy field for consecutive correct answers (unused)
		incorrect_streak: Legacy field for consecutive incorrect answers (unused)
		asked: Number of tasks completed in this session
		total: Total number of tasks in the session (default: 8)
		items: Dictionary mapping item IDs to SpeakingItem objects
		history: List of completed task assessments for analysis
	"""
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
	"""Extract JSON object from LLM response text.
	
	Attempts to parse the entire text as JSON first, then searches for the first
	JSON object using regex if direct parsing fails.
	
	Args:
		text: Raw text response from LLM that should contain JSON
		
	Returns:
		Parsed JSON object as dictionary
		
	Raises:
		ValueError: If no valid JSON can be extracted from the text
	"""
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
	"""Collapse repeated 1–3 word phrases and extra whitespace in transcript.
	
	Speech recognition often produces repeated phrases due to interim/final result overlap.
	This function removes duplicate words and phrases to clean up the transcript.
	
	Args:
		text: Raw transcript text that may contain repeated phrases
		
	Returns:
		Cleaned transcript with duplicates removed and normalized whitespace
	"""
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
	
	Uses linguistic features like vocabulary complexity, grammar structures, and
	discourse markers to estimate the speaker's CEFR level. This serves as a
	fallback when the LLM-based assessment fails.
	
	Args:
		transcript: Cleaned transcript text to analyze
		
	Returns:
		Dictionary with keys:
		- predicted_level: CEFR level (A1, A2, B1, B2, C1, C2)
		- feedback: Constructive advice for improvement
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
	"""Build LLM prompt for generating speaking tasks at a specific CEFR level.
	
	Creates a structured prompt that instructs the LLM to generate appropriate
	speaking tasks aligned with Cambridge exam standards for the given level.
	
	Args:
		level: Target CEFR level (A1, A2, B1, B2, C1, C2)
		
	Returns:
		Formatted prompt string for the LLM
	"""
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
	"""Generate a speaking task item for the given CEFR level.
	
	Uses the LLM to create an appropriate speaking prompt, preparation time,
	and recording time based on the target CEFR level and Cambridge exam standards.
	
	Args:
		level_index: Index into LEVELS array (0=A1, 1=A2, etc.)
		
	Returns:
		SpeakingItem with generated prompt, timing, and guidance
		
	Raises:
		HTTPException: If LLM fails to generate a valid prompt
	"""
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
	"""Legacy streak-based level adjustment (unused but kept for compatibility).
	
	This function implements the old adaptive algorithm that adjusts difficulty
	based on consecutive correct/incorrect answers. It's no longer used in
	favor of the LLM-based assessment in _adjust_level_direct().
	
	Args:
		state: Current session state containing level and streaks
		was_correct: Whether the last answer was correct
	"""
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


async def _evaluate_transcript(
	level: str,
	prompt_text: str,
	transcript: str,
	audio_base64: Optional[str] = None,
) -> Dict[str, Any]:
	"""Use LLM to assess student's CEFR level and performance relative to target.
	
	Evaluates the student's speaking performance using the LLM as an expert ESL examiner.
	Considers task achievement, grammar/vocabulary range, coherence, and fluency.
	
	Args:
		level: Target CEFR level for the task (A1, A2, B1, B2, C1, C2)
		prompt_text: The original speaking prompt given to the student
		transcript: Cleaned transcript of the student's response
		
	Returns:
		Dictionary with keys:
		- grade: "better", "equal", or "worse" relative to target level
		- feedback: Constructive feedback for improvement
		- predicted_level: Estimated CEFR level (A1-C2) or None if unclear
	"""
	client_model = "gemini-2.5-flash-lite"
	model = settings.gemini_model_listen or client_model
	client = GeminiClient(model=model)
	try:
		if audio_base64:
			analysis_instructions = f"""
You are an expert ESL speaking examiner. Evaluate the student's performance using BOTH the transcript and the provided audio sample. Estimate the student's CEFR level (A1–C2) and compare it against the target level {level}. Consider content, grammar, vocabulary, fluency, pronunciation, and accent characteristics.

Identify the most likely accent family you detect (for example: General American, British RP, Indian English, Australian, African, East Asian, Latin American, Mixed, Unclear). If unsure, respond with "Unclear". Provide a confidence value between 0 and 1.

Return STRICT JSON only with this structure:
{{
  "estimated_level": "A1|A2|B1|B2|C1|C2",
  "grade": "better|equal|worse",
  "overall_score": number (0-100),
  "text_feedback": "one or two sentences with concrete advice",
  "audio_feedback": "one sentence commenting on accent/clarity",
  "audio_analysis": {{
    "accent_label": string,
    "accent_confidence": number (0-1),
    "clarity_score": number (0-100),
    "fluency_score": number (0-100),
    "overall_audio_score": number (0-100)
  }}
}}
""".strip()
			parts = [
				{"text": analysis_instructions},
				{"text": f"Task prompt:\n{prompt_text}\n\nStudent transcript (verbatim):\n{transcript}"},
				{"inline_data": {"mime_type": "audio/webm", "data": audio_base64}},
			]
			raw = await client.generate_multimodal(parts)
		else:
			instructions = f"""
You are an expert ESL examiner. Assess the student's CEFR speaking level (A1–C2).

Context: The expected answer was based on a task appropriate for CEFR {level}. Use that as a reference point when comparing performance, but your primary job is to estimate the student's level.

Consider task achievement, range and control of grammar and vocabulary, coherence and fluency.

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
	feedback = (data.get("feedback") or data.get("text_feedback") or "").strip() or None
	audio_feedback = (data.get("audio_feedback") or "").strip() or None
	audio_analysis = data.get("audio_analysis") or {}

	def _safe_float(value: Any) -> Optional[float]:
		try:
			if value is None:
				return None
			return float(value)
		except (TypeError, ValueError):
			return None

	clarity_score = _safe_float(audio_analysis.get("clarity_score"))
	fluency_score = _safe_float(audio_analysis.get("fluency_score"))
	overall_audio_score = _safe_float(audio_analysis.get("overall_audio_score"))
	overall_score = _safe_float(data.get("overall_score"))
	accent_confidence = _safe_float(audio_analysis.get("accent_confidence"))
	accent_label = audio_analysis.get("accent_label")
	if isinstance(accent_label, str):
		accent_label = accent_label.strip() or None

	audio_scores_dict = {
		"clarity_score": clarity_score,
		"fluency_score": fluency_score,
		"overall_audio_score": overall_audio_score,
	}
	audio_scores = {k: v for k, v in audio_scores_dict.items() if v is not None}
	if not audio_scores:
		audio_scores = None

	return {
		"grade": grade,
		"feedback": feedback,
		"predicted_level": predicted,
		"overall_score": overall_score,
		"audio_feedback": audio_feedback or None,
		"audio_scores": audio_scores,
		"accent_label": accent_label,
		"accent_confidence": accent_confidence,
	}

def _adjust_level_direct(state: _SessionState, grade: str) -> None:
	"""Adjust difficulty level based on LLM assessment grade.
	
	Increases difficulty if performance is "better" than target, decreases if "worse".
	This is the current adaptive algorithm that replaces the legacy streak-based approach.
	
	Args:
		state: Current session state containing level index
		grade: Assessment grade ("better", "equal", or "worse")
	"""
	if grade == "better" and state.level_index < len(LEVELS) - 1:
		state.level_index += 1
	elif grade == "worse" and state.level_index > 0:
		state.level_index -= 1


async def _assess_pronunciation(audio_base64: str, expected_transcript: str) -> Dict[str, Any]:
	"""Assess pronunciation using Google Cloud Speech-to-Text API.
	
	Analyzes the audio recording to provide pronunciation feedback and scoring.
	Currently uses speech recognition confidence as a proxy for pronunciation quality.
	
	Args:
		audio_base64: Base64-encoded audio data
		expected_transcript: Expected transcript for comparison (currently unused)
		
	Returns:
		Dictionary with keys:
		- pronunciation_score: Confidence score (0-100) or None if unavailable
		- pronunciation_feedback: Feedback message or error description
	"""
	vertex_project = getattr(settings, "vertex_project", None)
	vertex_region = getattr(settings, "vertex_region", None)
	if not vertex_project or not vertex_region:
		return {"pronunciation_score": None, "pronunciation_feedback": "Pronunciation assessment requires Vertex AI project and region settings."}
	if not audio_base64:
		return {"pronunciation_score": None, "pronunciation_feedback": "No audio provided for pronunciation analysis."}

	try:
		client = speech.SpeechClient()
	except Exception as e:
		return {
			"pronunciation_score": None,
			"pronunciation_feedback": f"Pronunciation assessment unavailable: {e}",
		}

	audio_content = base64.b64decode(audio_base64)
	if not audio_content:
		return {"pronunciation_score": None, "pronunciation_feedback": "Empty audio payload received."}

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


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/start", response_model=StartResponse)
async def start(req: StartRequest, user: User = Depends(get_current_user)):
	"""Start a new speaking assessment session.
	
	Creates a new session with the specified starting level and generates the first
	speaking task. The session will contain 8 total speaking tasks with adaptive
	difficulty adjustment based on performance.
	
	Args:
		req: Request containing optional start_level (defaults to A2)
		user: Authenticated user (from JWT token)
		
	Returns:
		StartResponse with session details and first speaking task
		
	Raises:
		HTTPException: If start_level is invalid or session creation fails
	"""
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
	"""Submit a speaking task answer for assessment.
	
	Processes the student's transcript and optional audio recording to provide
	assessment feedback, pronunciation scoring, and adaptive level adjustment.
	Uses LLM-based evaluation with heuristic fallback for reliability.
	
	Args:
		req: Answer request containing session_id, item_id, transcript, and optional audio
		user: Authenticated user (from JWT token)
		
	Returns:
		AnswerResponse with assessment results, feedback, and next task (if available)
		
	Raises:
		HTTPException: If session/item not found or assessment fails
	"""
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
	audio_base64 = req.audio_base64 or ""
	overall_score: Optional[float] = None
	audio_feedback: Optional[str] = None
	audio_scores: Optional[Dict[str, float]] = None
	accent_label: Optional[str] = None
	accent_confidence: Optional[float] = None

	if transcript:
		try:
			eval_result = await _evaluate_transcript(
				item.cefr,
				item.prompt,
				clean_transcript,
				audio_base64=audio_base64 or None,
			)
			grade = eval_result["grade"]
			feedback = eval_result.get("feedback")
			predicted_level = eval_result.get("predicted_level")
			overall_score = eval_result.get("overall_score")
			audio_feedback = eval_result.get("audio_feedback")
			audio_scores = eval_result.get("audio_scores")
			accent_label = eval_result.get("accent_label")
			accent_confidence = eval_result.get("accent_confidence")
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
			"overall_score": overall_score,
			"audio_feedback": audio_feedback,
			"audio_scores": audio_scores,
			"accent_label": accent_label,
			"accent_confidence": accent_confidence,
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
		overall_score=overall_score,
		audio_feedback=audio_feedback,
		audio_scores=audio_scores,
		accent_label=accent_label,
		accent_confidence=accent_confidence,
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
	"""Get the next speaking task in the current session.
	
	Generates and returns the next speaking task based on the current adaptive
	level. The difficulty may have been adjusted based on previous performance.
	
	Args:
		req: Request containing session_id
		user: Authenticated user (from JWT token)
		
	Returns:
		StartResponse with the next speaking task and updated progress
		
	Raises:
		HTTPException: If session not found, expired, or already finished
	"""
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
