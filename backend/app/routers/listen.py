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


router = APIRouter(prefix="/listen", tags=["listening"])


CEFR_ORDER: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]
CAMBRIDGE_BY_CEFR: Dict[str, str] = {"A1": "KET", "A2": "KET", "B1": "PET", "B2": "FCE", "C1": "FCE", "C2": "FCE"}


class StartRequest(BaseModel):
    # start_level is now fixed to A2, no user selection
    pass


class Answer(BaseModel):
    clip_id: str
    choice_index: int


class SubmitRequest(BaseModel):
    session_id: str
    answers: List[Answer]


class ListenSession:
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


_sessions: Dict[str, ListenSession] = {}


def _validate_cefr(level: Optional[str]) -> str:
    return "A2"


def _map_band_to_exam(band: str) -> str:
    band = band.upper()
    if band in ("A1", "A2"):
        return "KET"
    if band == "B1":
        return "PET"
    # For B2, C1, C2, map to FCE (within requested exam family)
    return "FCE"


def _extract_json_object(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except Exception:
        pass
    code_block = re.search(r"```json\s*([\s\S]*?)\s*```", text)
    if code_block:
        candidate = code_block.group(1)
        try:
            return json.loads(candidate)
        except Exception:
            pass
    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        candidate = text[first : last + 1]
        try:
            return json.loads(candidate)
        except Exception:
            pass
    raise HTTPException(status_code=500, detail="LLM did not return valid JSON.")


def _build_listening_prompt(cefr: str, cambridge: str, count: int) -> str:
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
    raw = await client.generate(_build_listening_prompt(cefr, cambridge, count))
    data = _extract_json_object(raw)
    clips = data.get("clips")
    if not isinstance(clips, list) or len(clips) != count:
        raise HTTPException(status_code=500, detail=f"LLM did not return exactly {count} clips")
    normed: List[Dict[str, Any]] = []
    for idx, c in enumerate(clips, start=1):
        title = str(c.get("title", f"Clip {idx}")).strip()
        transcript = str(c.get("transcript", "")).strip()
        question = str(c.get("question", "")).strip()
        options = c.get("options", [])
        correct_index = c.get("correct_index", None)
        rationale = c.get("rationale", "")
        exam_task_type = str(c.get("exam_task_type", "gist")).strip()
        targets = c.get("targets", {}) or {}
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
        clip_id = f"c{idx}-{uuid.uuid4().hex[:8]}"
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


@router.post("/session/start")
async def start_session(req: StartRequest, user: User = Depends(get_current_user)):
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
        # Return without revealing correct_index
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


def _adjust_after_pair(state: ListenSession, pair: List[bool]) -> None:
    # Apply two-answer adaptation rules with special C2 handling
    if len(pair) != 2:
        return
    before_level = state.current_cefr
    both_correct = (pair[0] and pair[1])
    both_incorrect = ((not pair[0]) and (not pair[1]))
    if before_level == "C2":
        # Any mistake in the pair at C2 causes a decrease
        if not both_correct:
            idx = CEFR_ORDER.index(before_level)
            if idx > 0:
                state.current_cefr = CEFR_ORDER[idx - 1]
                state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
            return
    if both_correct:
        idx = CEFR_ORDER.index(before_level)
        if idx < len(CEFR_ORDER) - 1:
            state.current_cefr = CEFR_ORDER[idx + 1]
            state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
    elif both_incorrect:
        idx = CEFR_ORDER.index(before_level)
        if idx > 0:
            state.current_cefr = CEFR_ORDER[idx - 1]
            state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]


@router.post("/session/submit")
async def submit_answers(req: SubmitRequest, user: User = Depends(get_current_user)):
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
        # Append detailed log
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
        # After each pair, adjust difficulty
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

    # Aggregate targets across all seen clips
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

