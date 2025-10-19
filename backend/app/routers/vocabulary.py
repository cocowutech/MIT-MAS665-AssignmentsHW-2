from __future__ import annotations

import asyncio
import json
import re
import uuid
import httpx
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..gemini_client import GeminiClient
from .auth import User, get_current_user


router = APIRouter(prefix="/vocabulary", tags=["vocabulary"])


LEVELS: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]


def level_to_exam(level: str) -> str:
    # Map CEFR to Cambridge target focus per user spec (KET/PET/FCE).
    # For C1/C2, continue to use FCE-style targets but with advanced range.
    if level in ("A1", "A2"):
        return "KET"
    if level == "B1":
        return "PET"
    return "FCE"


class Question(BaseModel):
    id: str
    cefr: str
    exam_target: str
    passage: str
    question: str
    options: List[str]
    answer_index: int = Field(ge=0)
    rationale: Optional[str] = None


class StartRequest(BaseModel):
    start_level: Optional[str] = Field(default="A2", description="Initial CEFR level A1–C2 (default A2)")


class StartResponse(BaseModel):
    session_id: str
    question: Question
    progress_current: int
    progress_total: int
    level: str


class AnswerRequest(BaseModel):
    session_id: str
    question_id: str
    choice_index: int


class AnswerResponse(BaseModel):
    correct: bool
    level: str
    progress_current: int
    progress_total: int
    finished: bool
    explanation: Optional[str] = None


class _SessionState:
    def __init__(self, level_index: int, total: int = 15) -> None:
        self.session_id: str = uuid.uuid4().hex
        self.level_index: int = level_index
        self.correct_streak: int = 0
        self.incorrect_streak: int = 0
        self.asked: int = 0
        self.total: int = total
        self.questions: Dict[str, Question] = {}
        self.history: List[Dict[str, Any]] = []
        self._question_cache: Dict[int, List[Question]] = {}
        self._cache_lock: asyncio.Lock = asyncio.Lock()


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


async def _generate_question_for(level_index: int) -> Question:
    level = LEVELS[level_index]
    exam = level_to_exam(level)
    prompt = f"""
You are an assessment item writer. Generate ONE adaptive vocabulary MCQ based on a SHORT passage.

Constraints:
- CEFR level: {level}
- Cambridge target focus: {exam} (vocabulary and grammar structures appropriate to {exam})
- Make the passage 40–90 words. Use natural, age-neutral, general-interest content.
- The question should assess target vocabulary/structures (e.g., collocations, phrasal verbs, form/meaning/use) suitable for CEFR {level} and {exam}.
- The item type should be a single 4-option multiple choice. Prefer gap-fill in-context, synonym-in-context, or best completion.
- Exactly 4 options; only one correct; use plausible distractors at the same register.
- Distractors must be unambiguously wrong for the blank (semantic or grammatical mismatch). Synonyms or paraphrases that could also complete the sentence are not allowed.
- In the rationale, briefly explain why the correct option works and why each distractor fails.
- Output STRICTLY JSON, no markdown, no commentary.

JSON schema to return exactly:
{{
  "passage": string,
  "question": string,
  "options": [string, string, string, string],
  "answer_index": integer (0-3),
  "rationale": string (brief, 1-2 sentences)
}}
""".strip()

    last_error: Optional[Exception] = None
    for _ in range(4):
        # Use Gemini 2.0 Flash-Lite specifically for this module
        client: Optional[GeminiClient] = None
        try:
            client = GeminiClient(model="gemini-2.0-flash-lite")
            raw = await client.generate(prompt)
            try:
                data = _extract_json_block(raw)
            except Exception as e:
                last_error = e
                continue

            passage = str(data.get("passage", "")).strip()
            question_text = str(data.get("question", "")).strip()
            options = data.get("options") or []
            answer_index = data.get("answer_index")
            rationale = (data.get("rationale") or "").strip() or None

            if not passage or not question_text or not isinstance(options, list) or len(options) != 4:
                last_error = ValueError("invalid item format")
                continue
            try:
                answer_index_int = int(answer_index)
            except Exception as e:
                last_error = e
                continue
            if not (0 <= answer_index_int < 4):
                last_error = ValueError("answer index out of range")
                continue

            q = Question(
                id=uuid.uuid4().hex,
                cefr=level,
                exam_target=exam,
                passage=passage,
                question=question_text,
                options=[str(o) for o in options],
                answer_index=answer_index_int,
                rationale=rationale,
            )

            is_unique = await _validate_unique_answer(q)
            if not is_unique:
                last_error = ValueError("question failed uniqueness validation")
                continue

            return q
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 503:
                print(f"Gemini API unavailable (503). No question could be generated. Error: {e}")
                raise HTTPException(status_code=503, detail="Gemini API unavailable. No question could be generated.")
            else:
                last_error = e
                continue
        finally:
            if client is not None:
                await client.aclose()

    # If we reach here, both attempts failed
    msg = f"LLM parse/format error: {last_error}" if last_error else "LLM error"
    raise HTTPException(status_code=502, detail=msg)


async def _validate_unique_answer(question: Question) -> bool:
    prompt = """
You are validating a multiple choice vocabulary question. Inspect the passage, the question with its blank, and the four answer options.

Return JSON with the following schema exactly (no extra keys, no markdown):
{
  "correct_indices": [int, ...],
  "notes": string
}

"correct_indices" must list every option index (0-3) that produces a grammatically and semantically correct completion for the blank. If the sentence would remain correct or acceptable with multiple options, include all of them.

Keep the notes very brief (≤40 words).
""".strip()

    options_lines = "\n".join(f"{idx}. {opt}" for idx, opt in enumerate(question.options))
    validation_payload = f"""
Passage:
{question.passage}

Item:
{question.question}

Options:
{options_lines}

Target answer index: {question.answer_index}
""".strip()

    client: Optional[GeminiClient] = None
    try:
        client = GeminiClient(model="gemini-2.0-flash-lite")
        raw = await client.generate(f"{prompt}\n\n{validation_payload}")
        data = _extract_json_block(raw)
    except Exception as exc:
        print(f"Validation parsing error: {exc}")
        return False
    finally:
        if client is not None:
            await client.aclose()

    indices = data.get("correct_indices")
    if not isinstance(indices, list):
        return False
    normalized: List[int] = []
    for idx in indices:
        val = None
        if isinstance(idx, int):
            val = idx
        elif isinstance(idx, str) and idx.strip().isdigit():
            val = int(idx.strip())
        if val is None:
            continue
        if 0 <= val < len(question.options):
            normalized.append(val)

    normalized = sorted(set(normalized))

    if len(normalized) != 1:
        return False

    return normalized[0] == question.answer_index


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


async def _preload_questions(state: _SessionState, current_level_index: int):
    levels_to_preload = set()
    levels_to_preload.add(current_level_index)
    if current_level_index > 0:
        levels_to_preload.add(current_level_index - 1)
    if current_level_index < len(LEVELS) - 1:
        levels_to_preload.add(current_level_index + 1)

    for level_idx in levels_to_preload:
        # Preload 2 questions for each relevant level
        for _ in range(2):
            try:
                q = await _generate_question_for(level_idx)
                async with state._cache_lock:
                    if level_idx not in state._question_cache:
                        state._question_cache[level_idx] = []
                    state._question_cache[level_idx].append(q)
            except Exception as e:
                # Log the error but don't block the main flow
                print(f"Error preloading question for level {LEVELS[level_idx]}: {e}")


@router.post("/start", response_model=StartResponse)
async def start(req: StartRequest, user: User = Depends(get_current_user)):
    # Default to A2 and respect valid client-provided start_level
    level = (req.start_level or "A2").upper()
    if level not in LEVELS:
        raise HTTPException(status_code=400, detail="start_level must be one of A1,A2,B1,B2,C1,C2")
    state = _SessionState(level_index=LEVELS.index(level), total=15)
    _sessions[state.session_id] = state

    # Preload questions in the background
    asyncio.create_task(_preload_questions(state, state.level_index))

    # Get the first question, prioritizing from cache if available
    q: Optional[Question] = None
    async with state._cache_lock:
        if state.level_index in state._question_cache and state._question_cache[state.level_index]:
            q = state._question_cache[state.level_index].pop(0)
    if not q:
        q = await _generate_question_for(state.level_index)

    state.questions[q.id] = q
    state.asked = 1

    return StartResponse(
        session_id=state.session_id,
        question=q,
        progress_current=state.asked,
        progress_total=state.total,
        level=LEVELS[state.level_index],
    )


@router.post("/answer", response_model=AnswerResponse)
async def answer(req: AnswerRequest, user: User = Depends(get_current_user)):
    state = _sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    q = state.questions.get(req.question_id)
    if not q:
        raise HTTPException(status_code=400, detail="Unknown question_id for this session")

    was_correct = int(req.choice_index) == q.answer_index
    state.history.append(
        {
            "question_id": q.id,
            "choice_index": int(req.choice_index),
            "answer_index": q.answer_index,
            "correct": was_correct,
            "level": q.cefr,
        }
    )

    _adjust_level(state, was_correct)

    finished = state.asked >= state.total
    if not finished:
        # Preload questions for the new level in the background
        asyncio.create_task(_preload_questions(state, state.level_index))
        state.asked += 1

    response = AnswerResponse(
        correct=was_correct,
        level=LEVELS[state.level_index],
        progress_current=state.asked,
        progress_total=state.total,
        finished=finished,
        explanation=q.rationale,
    )

    # Cleanup session if finished
    if finished:
        try:
            del _sessions[state.session_id]
        except KeyError:
            pass

    return response


class NextQuestionRequest(BaseModel):
    session_id: str


class NextQuestionResponse(BaseModel):
    question: Question


@router.post("/next_question", response_model=NextQuestionResponse)
async def next_question(req: NextQuestionRequest, user: User = Depends(get_current_user)):
    state = _sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    # Try to get the next question from cache
    q: Optional[Question] = None
    async with state._cache_lock:
        if state.level_index in state._question_cache and state._question_cache[state.level_index]:
            q = state._question_cache[state.level_index].pop(0)

    # If not in cache, generate it
    if not q:
        q = await _generate_question_for(state.level_index)

    state.questions[q.id] = q
    # Do NOT increment state.asked here, as this is a pre-fetch. Increment happens on answer submission.

    # Preload more questions in the background to keep the cache full
    asyncio.create_task(_preload_questions(state, state.level_index))

    return NextQuestionResponse(question=q)
