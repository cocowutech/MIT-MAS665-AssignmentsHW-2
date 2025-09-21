from __future__ import annotations
import json
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..gemini_client import GeminiClient
from ..settings import settings
from .auth import User, get_current_user


router = APIRouter(prefix="/listen", tags=["listening"])


CEFR_ORDER: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]
CAMBRIDGE_BY_CEFR: Dict[str, str] = {"A1": "KET", "A2": "KET", "B1": "PET", "B2": "FCE", "C1": "FCE", "C2": "FCE"}


class StartRequest(BaseModel):
    level_cefr: Optional[str] = None  # One of A1, A2, B1, B2, C1, C2 (default A2)


class Answer(BaseModel):
    clip_id: str
    choice_index: int


class SubmitRequest(BaseModel):
    session_id: str
    answers: List[Answer]


class ListenSession:
    def __init__(self, session_id: str, username: str, start_cefr: str, clips: List[Dict[str, Any]]):
        self.session_id = session_id
        self.username = username
        self.start_cefr = start_cefr
        self.clips = clips  # Each has id, title, transcript, question, choices, correct_index, cefr, cambridge_level, exam_task_type, targets
        self.ended = False


_sessions: Dict[str, ListenSession] = {}


def _validate_cefr(level: Optional[str]) -> str:
    if not level:
        return "A2"
    level_u = level.upper()
    if level_u not in CEFR_ORDER:
        raise HTTPException(status_code=400, detail=f"level_cefr must be one of {CEFR_ORDER}")
    return level_u


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


def _build_listening_prompt(cefr: str, cambridge: str) -> str:
    return (
        "You are an ESL listening item writer. Generate THREE short audio clip scripts with MCQs.\n"
        f"Target difficulty: CEFR {cefr}. Cambridge mapping: {cambridge}.\n"
        "Each clip should be naturalistic spoken English (conversational or announcement), 70–110 words,\n"
        "and include typical vocabulary/structures for the level.\n\n"
        "For EACH clip, produce: title (short), transcript (the exact text to be spoken),\n"
        "one multiple-choice question testing gist/detail/inference, options (exactly 4), correct_index (0–3),\n"
        "exam_task_type (e.g., gist, detail, inference), targets.target_vocab (5–10 items), targets.target_structures (3–6 items).\n"
        "Ensure only ONE correct option and others are plausible distractors.\n\n"
        "Return ONLY compact JSON with keys: clips (array of 3 objects with fields: id, title, transcript, question, options, correct_index, rationale, cefr, cambridge_level, exam_task_type, targets {target_vocab, target_structures}).\n"
        f"Set cefr='{cefr}' and cambridge_level='{cambridge}' for each clip. No markdown, no extra commentary."
    )


async def _llm_generate_clips(client: GeminiClient, cefr: str, cambridge: str) -> List[Dict[str, Any]]:
    raw = await client.generate(_build_listening_prompt(cefr, cambridge))
    data = _extract_json_object(raw)
    clips = data.get("clips")
    if not isinstance(clips, list) or len(clips) != 3:
        raise HTTPException(status_code=500, detail="LLM did not return exactly 3 clips")
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
    level = _validate_cefr(req.level_cefr)
    session_id = uuid.uuid4().hex
    # Prefer flash-lite for listening as per requirement, allow env override
    preferred_model = settings.gemini_model_listen or "gemini-2.5-flash-lite"
    client = GeminiClient(model=preferred_model)
    try:
        clips = await _llm_generate_clips(client, level, CAMBRIDGE_BY_CEFR[level])
        state = ListenSession(session_id=session_id, username=user.username, start_cefr=level, clips=clips)
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
            "target_cefr": level,
            "cambridge_level": CAMBRIDGE_BY_CEFR[level],
            "clips": public_clips,
        }
    finally:
        await client.aclose()


@router.post("/session/submit")
async def submit_answers(req: SubmitRequest, user: User = Depends(get_current_user)):
    state = _sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    if state.ended:
        raise HTTPException(status_code=400, detail="Session already ended")

    # Build lookup for clips
    id_to_clip: Dict[str, Dict[str, Any]] = {c["id"]: c for c in state.clips}
    per_item: List[Dict[str, Any]] = []
    correct = 0
    total = 0
    for ans in req.answers:
        clip = id_to_clip.get(ans.clip_id)
        if not clip:
            raise HTTPException(status_code=400, detail=f"Unknown clip_id: {ans.clip_id}")
        if ans.choice_index < 0 or ans.choice_index > 3:
            raise HTTPException(status_code=400, detail="choice_index must be 0..3")
        is_correct = (ans.choice_index == clip["correct_index"])
        correct += 1 if is_correct else 0
        total += 1
        per_item.append(
            {
                "clip_id": clip["id"],
                "correct": is_correct,
                "correct_choice_index": clip["correct_index"],
                "rationale": clip.get("rationale", ""),
                "level_cefr": clip["level_cefr"],
                "cambridge_level": clip["cambridge_level"],
            }
        )

    if total != 3:
        # Not fatal, but encourage answering all
        pass

    # Heuristic band estimate from performance relative to targeted CEFR
    start_idx = CEFR_ORDER.index(state.start_cefr)
    estimated_idx = start_idx
    if correct <= 1:
        estimated_idx = max(0, start_idx - 1)
    elif correct == 2:
        estimated_idx = start_idx
    else:  # 3 correct
        estimated_idx = min(len(CEFR_ORDER) - 1, start_idx + 1)
    estimated_band = CEFR_ORDER[estimated_idx]
    exam = _map_band_to_exam(estimated_band)

    # Aggregate targets across clips
    agg_vocab: List[str] = []
    agg_structs: List[str] = []
    for c in state.clips:
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
        "incorrect": max(0, total - correct),
        "total": total,
        "estimated_band": estimated_band,
        "exam_mapping": {
            "exam": exam,
            "target_vocab": agg_vocab[:20],
            "target_structures": agg_structs[:12],
        },
        "per_item": per_item,
        "finished": True,
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


