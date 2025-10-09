"""
Listening Module Backend Router

This module provides the backend API endpoints for the ESL listening assessment system.
It handles:
- Session management and initialization
- Adaptive difficulty adjustment based on user performance
- Text-to-speech content generation using Gemini AI
- Answer evaluation and feedback
- Progress tracking and final assessment results

The system implements a two-answer adaptation algorithm that adjusts difficulty
after each pair of questions based on correctness patterns.

Author: ESL Assessment System
Version: 1.0
"""

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

# Initialize FastAPI router for listening endpoints
router = APIRouter(prefix="/listen", tags=["listening"])

# CEFR (Common European Framework of Reference) level ordering
# Used for difficulty progression and adaptation logic
CEFR_ORDER: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Mapping from CEFR levels to Cambridge English exam equivalents
# Used for exam preparation context and difficulty calibration
CAMBRIDGE_BY_CEFR: Dict[str, str] = {"A1": "KET", "A2": "KET", "B1": "PET", "B2": "FCE", "C1": "FCE", "C2": "FCE"}


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class StartRequest(BaseModel):
    """
    Request model for starting a new listening session.
    
    Note: start_level is now fixed to A2, no user selection allowed.
    This ensures consistent baseline assessment across all users.
    """
    pass


class Answer(BaseModel):
    """
    Represents a user's answer to a listening comprehension question.
    
    Attributes:
        clip_id: Unique identifier for the audio clip
        choice_index: Index of the selected answer choice (0-3)
    """
    clip_id: str
    choice_index: int


class SubmitRequest(BaseModel):
    """
    Request model for submitting answers to listening questions.
    
    Attributes:
        session_id: Unique identifier for the current session
        answers: List of user answers for the current batch of questions
    """
    session_id: str
    answers: List[Answer]


# ============================================================================
# SESSION MANAGEMENT
# ============================================================================

class ListenSession:
    """
    Manages the state of a listening assessment session.
    
    This class tracks user progress, difficulty adaptation, and maintains
    comprehensive logs for final assessment and feedback generation.
    
    Attributes:
        session_id: Unique identifier for this session
        username: User who initiated the session
        start_cefr: Initial CEFR level (always A2)
        current_cefr: Current adaptive CEFR level
        cambridge_level: Current Cambridge exam equivalent
        clips: Currently active batch of clips to answer
        total: Total number of questions in the session
        asked: Number of questions answered so far
        history: List of correctness results (True/False) for each answered question
        answer_log: Detailed per-item information for final summary
        clip_lookup: Dictionary mapping clip IDs to clip data for aggregation
        ended: Whether the session has been completed
    """
    
    def __init__(self, session_id: str, username: str, start_cefr: str, clips: List[Dict[str, Any]], *, total: int = 10):
        self.session_id = session_id
        self.username = username
        self.start_cefr = start_cefr
        self.current_cefr = start_cefr
        self.cambridge_level = CAMBRIDGE_BY_CEFR[self.current_cefr]
        self.clips = clips  # currently active batch of clips to answer
        self.total = total
        self.asked = 0
        self.history: List[bool] = []  # correctness per answered item (ordered)
        self.answer_log: List[Dict[str, Any]] = []  # detailed per-item info for final summary
        # Keep lookup of all clips in the session for rationale/targets aggregation
        self.clip_lookup: Dict[str, Dict[str, Any]] = {c["id"]: c for c in clips}
        self.ended = False


# Global session storage - in production, this should be replaced with a database
# Might not be relevant anymore - consider using Redis or database for production
_sessions: Dict[str, ListenSession] = {}


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def _validate_cefr(level: Optional[str]) -> str:
    """
    Validate and normalize CEFR level.
    
    Currently always returns A2 as the starting level for consistency.
    This ensures all users begin at the same baseline difficulty.
    
    Args:
        level: Input CEFR level (ignored, always returns A2)
        
    Returns:
        str: Always returns "A2"
    """
    return "A2"


def _map_band_to_exam(band: str) -> str:
    """
    Map CEFR band to corresponding Cambridge English exam.
    
    This mapping is used for exam preparation context and difficulty
    calibration in the assessment system.
    
    Args:
        band: CEFR level (A1, A2, B1, B2, C1, C2)
        
    Returns:
        str: Corresponding Cambridge exam (KET, PET, FCE)
    """
    band = band.upper()
    if band in ("A1", "A2"):
        return "KET"
    if band == "B1":
        return "PET"
    # For B2, C1, C2, map to FCE (within requested exam family)
    return "FCE"


def _extract_json_object(text: str) -> Dict[str, Any]:
    """
    Extract JSON object from LLM response text.
    
    This function handles various formats that LLMs might return:
    - Raw JSON
    - JSON wrapped in markdown code blocks
    - JSON embedded in other text
    
    Args:
        text: Raw text response from LLM
        
    Returns:
        Dict[str, Any]: Parsed JSON object
        
    Raises:
        HTTPException: If no valid JSON can be extracted
    """
    # Try direct JSON parsing first
    try:
        return json.loads(text)
    except Exception:
        pass
    
    # Try extracting from markdown code blocks
    code_block = re.search(r"```json\s*([\s\S]*?)\s*```", text)
    if code_block:
        candidate = code_block.group(1)
        try:
            return json.loads(candidate)
        except Exception:
            pass
    
    # Try extracting first JSON object from text
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidate = text[first : last + 1]
        try:
            return json.loads(candidate)
        except Exception:
            pass
    
    raise HTTPException(status_code=500, detail="LLM did not return valid JSON.")


# ============================================================================
# AI CONTENT GENERATION
# ============================================================================

def _build_listening_prompt(cefr: str, cambridge: str, count: int) -> str:
    """
    Build prompt for Gemini AI to generate listening comprehension content.
    
    This function creates a detailed prompt that instructs the AI to generate
    authentic listening materials with appropriate difficulty levels and
    comprehensive metadata for assessment purposes.
    
    Args:
        cefr: Target CEFR level for content difficulty
        cambridge: Cambridge exam equivalent for context
        count: Number of listening clips to generate
        
    Returns:
        str: Formatted prompt for AI content generation
    """
    return (
        f"You are an ESL listening item writer. Generate {count} short audio clip scripts with MCQs.\n"
        f"Target difficulty: CEFR {cefr}. Cambridge mapping: {cambridge}.\n"
        "Each clip should be naturalistic spoken English (conversational or announcement), 70–110 words,\n"
        "and include typical vocabulary/structures for the level.\n\n"
        "For EACH clip, produce: title (short), transcript (the exact text to be spoken),\n"
        "one multiple-choice question testing gist/detail/inference, options (exactly 4), correct_index (0–3),\n"
        "exam_task_type (e.g., gist, detail, inference), targets.target_vocab (5–10 items), targets.target_structures (3–6 items).\n"
        "Ensure only ONE correct option and others are plausible distractors.\n\n"
        f"Return ONLY compact JSON with keys: clips (array of {count} objects with fields: id, title, transcript, question, options, correct_index, rationale, cefr, cambridge_level, exam_task_type, targets {{target_vocab, target_structures}}).\n"
        f"Set cefr='{cefr}' and cambridge_level='{cambridge}' for each clip. No markdown, no extra commentary."
    )


async def _llm_generate_clips(client: GeminiClient, cefr: str, cambridge: str, *, count: int = 3) -> List[Dict[str, Any]]:
    """
    Generate listening comprehension clips using Gemini AI.
    
    This function uses the Gemini AI client to generate authentic listening
    materials with appropriate difficulty levels and comprehensive metadata.
    It validates the AI response and normalizes the data structure.
    
    Args:
        client: Gemini AI client instance
        cefr: Target CEFR level for content difficulty
        cambridge: Cambridge exam equivalent for context
        count: Number of listening clips to generate
        
    Returns:
        List[Dict[str, Any]]: List of normalized clip objects
        
    Raises:
        HTTPException: If AI response is invalid or malformed
    """
    raw = await client.generate(_build_listening_prompt(cefr, cambridge, count))
    data = _extract_json_object(raw)
    clips = data.get("clips")
    
    if not isinstance(clips, list) or len(clips) != count:
        raise HTTPException(status_code=500, detail=f"LLM did not return exactly {count} clips")
    
    normed: List[Dict[str, Any]] = []
    for idx, c in enumerate(clips, start=1):
        # Extract and validate clip data
        title = str(c.get("title", f"Clip {idx}")).strip()
        transcript = str(c.get("transcript", "")).strip()
        question = str(c.get("question", "")).strip()
        options = c.get("options", [])
        correct_index = c.get("correct_index", None)
        rationale = c.get("rationale", "")
        exam_task_type = str(c.get("exam_task_type", "gist")).strip()
        targets = c.get("targets", {}) or {}
        
        # Validate required fields and format
        if (
            not transcript
            or not question
            or not isinstance(options, list)
            or len(options) != 4
            or not isinstance(correct_index, int)
            or correct_index < 0
            or correct_index > 3
        ):
            raise HTTPException(status_code=500, detail="Invalid clip/question format from LLM")
        
        # Generate unique clip ID
        clip_id = f"c{idx}-{uuid.uuid4().hex[:8]}"
        
        # Create normalized clip object
        normed.append(
            {
                "id": clip_id,
                "title": title,
                "transcript": transcript,
                "question": question,
                "choices": [str(o).strip() for o in options],
                "correct_index": int(correct_index),
                "rationale": str(rationale).strip() if isinstance(rationale, str) else "",
                "level_cefr": cefr,
                "cambridge_level": cambridge,
                "exam_task_type": exam_task_type,
                "targets": {
                    "target_vocab": [str(x).strip() for x in (targets.get("target_vocab") or [])][:10],
                    "target_structures": [str(x).strip() for x in (targets.get("target_structures") or [])][:6],
                },
            }
        )
    return normed


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.post("/session/start")
async def start_session(req: StartRequest, user: User = Depends(get_current_user)):
    """
    Start a new listening assessment session.
    
    This endpoint initializes a new listening session with:
    - Fixed A2 starting level for consistency
    - Initial batch of 2 listening clips
    - Session state tracking for adaptive difficulty
    - Total of 10 questions across 5 iterations
    
    Args:
        req: Start request (currently unused, level fixed to A2)
        user: Authenticated user from dependency injection
        
    Returns:
        Dict containing session metadata and initial clips
        
    Raises:
        HTTPException: If session initialization fails
    """
    level = _validate_cefr(getattr(req, "start_level", None))
    session_id = uuid.uuid4().hex
    
    # Prefer flash-lite for listening as per requirement, allow env override
    preferred_model = settings.gemini_model_listen or "gemini-2.5-flash-lite"
    client = GeminiClient(model=preferred_model)
    
    try:
        # Start with 2 clips; total session is 10 (5 iterations of 2 items)
        clips = await _llm_generate_clips(client, level, CAMBRIDGE_BY_CEFR[level], count=2)
        state = ListenSession(session_id=session_id, username=user.username, start_cefr=level, clips=clips, total=10)
        _sessions[session_id] = state
        
        # Return without revealing correct_index to prevent cheating
        public_clips = [
            {
                "id": c["id"],
                "title": c["title"],
                "transcript": c["transcript"],
                "question": c["question"],
                "choices": c["choices"],
                "level_cefr": c["level_cefr"],
                "cambridge_level": c["cambridge_level"],
                "exam_task_type": c["exam_task_type"],
                "targets": c["targets"],
            }
            for c in clips
        ]
        
        return {
            "session_id": session_id,
            "target_cefr": state.current_cefr,
            "cambridge_level": state.cambridge_level,
            "clips": public_clips,
            "asked": state.asked,
            "remaining": max(0, state.total - state.asked),
            "finished": False,
        }
    finally:
        await client.aclose()


# ============================================================================
# ADAPTIVE DIFFICULTY ALGORITHM
# ============================================================================

def _adjust_after_pair(state: ListenSession, pair: List[bool]) -> None:
    """
    Adjust difficulty level based on the last two answers.
    
    This function implements a two-answer adaptation algorithm that:
    - Increases difficulty if both answers are correct
    - Decreases difficulty if both answers are incorrect
    - Maintains current level for mixed results (except at C2)
    - Special handling for C2 level (any mistake causes decrease)
    
    Args:
        state: Current session state to modify
        pair: List of two boolean values representing correctness of last two answers
    """
    # Apply two-answer adaptation rules with special C2 handling
    if len(pair) != 2:
        return
    
    before_level = state.current_cefr
    both_correct = (pair[0] and pair[1])
    both_incorrect = ((not pair[0]) and (not pair[1]))
    
    # Special handling for C2 level - any mistake causes decrease
    if before_level == "C2":
        if not both_correct:
            idx = CEFR_ORDER.index(before_level)
            if idx > 0:
                state.current_cefr = CEFR_ORDER[idx - 1]
                state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
        return
    
    # Standard adaptation rules
    if both_correct:
        # Increase difficulty if both answers are correct
        idx = CEFR_ORDER.index(before_level)
        if idx < len(CEFR_ORDER) - 1:
            state.current_cefr = CEFR_ORDER[idx + 1]
            state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
    elif both_incorrect:
        # Decrease difficulty if both answers are incorrect
        idx = CEFR_ORDER.index(before_level)
        if idx > 0:
            state.current_cefr = CEFR_ORDER[idx - 1]
            state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]


@router.post("/session/submit")
async def submit_answers(req: SubmitRequest, user: User = Depends(get_current_user)):
    """
    Submit answers for current batch of listening questions.
    
    This endpoint processes user answers and:
    - Validates answers against current active clips
    - Evaluates correctness and updates session state
    - Applies adaptive difficulty adjustment after each pair
    - Generates next batch if session continues
    - Returns final results if session is complete
    
    Args:
        req: Submit request containing session ID and user answers
        user: Authenticated user from dependency injection
        
    Returns:
        Dict containing evaluation results and next steps
        
    Raises:
        HTTPException: If session not found, already ended, or validation fails
    """
    state = _sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    if state.ended:
        raise HTTPException(status_code=400, detail="Session already ended")

    # Validate against currently active batch
    id_to_clip: Dict[str, Dict[str, Any]] = {c["id"]: c for c in state.clips}
    evaluated_batch: List[Dict[str, Any]] = []
    
    for ans in req.answers:
        clip = id_to_clip.get(ans.clip_id)
        if not clip:
            raise HTTPException(status_code=400, detail=f"Unknown clip_id: {ans.clip_id}")
        if ans.choice_index < 0 or ans.choice_index > 3:
            raise HTTPException(status_code=400, detail="choice_index must be 0..3")
        
        is_correct = (ans.choice_index == clip["correct_index"])
        
        # Append detailed log for final summary
        state.answer_log.append(
            {
                "clip_id": clip["id"],
                "correct": is_correct,
                "correct_choice_index": clip["correct_index"],
                "rationale": clip.get("rationale", ""),
                "level_cefr": clip["level_cefr"],
                "cambridge_level": clip["cambridge_level"],
            }
        )
        
        state.history.append(is_correct)
        state.asked += 1
        
        # After each pair, adjust difficulty using adaptive algorithm
        if state.asked % 2 == 0:
            _adjust_after_pair(state, state.history[-2:])
        
        evaluated_batch.append(
            {
                "clip_id": clip["id"],
                "chosen_index": ans.choice_index,
                "correct_choice_index": clip["correct_index"],
                "correct": is_correct,
                "rationale": clip.get("rationale", ""),
            }
        )

    # If session not finished, generate next batch at current level
    if state.asked < state.total:
        remaining = state.total - state.asked
        batch_size = min(2, remaining)
        preferred_model = settings.gemini_model_listen or "gemini-2.5-flash-lite"
        client = GeminiClient(model=preferred_model)
        
        try:
            new_clips = await _llm_generate_clips(client, state.current_cefr, state.cambridge_level, count=batch_size)
        finally:
            await client.aclose()
        
        state.clips = new_clips
        for c in new_clips:
            state.clip_lookup[c["id"]] = c
        
        # Return public clips without revealing correct answers
        public_clips = [
            {
                "id": c["id"],
                "title": c["title"],
                "transcript": c["transcript"],
                "question": c["question"],
                "choices": c["choices"],
                "level_cefr": c["level_cefr"],
                "cambridge_level": c["cambridge_level"],
                "exam_task_type": c["exam_task_type"],
                "targets": c["targets"],
            }
            for c in new_clips
        ]
        
        return {
            "session_id": state.session_id,
            "target_cefr": state.current_cefr,
            "cambridge_level": state.cambridge_level,
            "clips": public_clips,
            "asked": state.asked,
            "remaining": remaining,
            "finished": False,
            "evaluated": evaluated_batch,
        }

    # Session finished — compute final summary across all answers
    correct = sum(1 for b in state.history if b)
    incorrect = max(0, len(state.history) - correct)

    # Aggregate targets across all seen clips for comprehensive feedback
    agg_vocab: List[str] = []
    agg_structs: List[str] = []
    for c in state.clip_lookup.values():
        tv = c.get("targets", {}).get("target_vocab") or []
        ts = c.get("targets", {}).get("target_structures") or []
        for v in tv:
            if v not in agg_vocab:
                agg_vocab.append(v)
        for s in ts:
            if s not in agg_structs:
                agg_structs.append(s)

    state.ended = True

    return {
        "correct": correct,
        "incorrect": incorrect,
        "total": state.total,
        "final_level": state.current_cefr,
        "exam_mapping": {
            "exam": _map_band_to_exam(state.current_cefr),
            "target_vocab": agg_vocab[:20],
            "target_structures": agg_structs[:12],
        },
        "per_item": state.answer_log,
        "finished": True,
        "evaluated": evaluated_batch,
    }


@router.get("/session/state")
async def get_state(session_id: str, user: User = Depends(get_current_user)):
    """
    Get current state of a listening session.
    
    This endpoint allows clients to retrieve the current state of an active
    session, including current clips and progress information. Useful for
    session recovery and state synchronization.
    
    Args:
        session_id: Unique identifier for the session
        user: Authenticated user from dependency injection
        
    Returns:
        Dict containing current session state and clips
        
    Raises:
        HTTPException: If session not found
    """
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return {
        "session_id": state.session_id,
        "target_cefr": state.start_cefr,
        "clips": [
            {
                "id": c["id"],
                "title": c["title"],
                "transcript": c["transcript"],
                "question": c["question"],
                "choices": c["choices"],
                "level_cefr": c["level_cefr"],
                "cambridge_level": c["cambridge_level"],
                "exam_task_type": c["exam_task_type"],
                "targets": c["targets"],
            }
            for c in state.clips
        ],
        "finished": state.ended,
    }

