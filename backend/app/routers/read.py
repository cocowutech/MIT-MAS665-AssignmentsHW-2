from __future__ import annotations
import json
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..gemini_client import GeminiClient
from .auth import User, get_current_user
from ..db import get_db
from ..models import UserAccount, ReadModule
from sqlalchemy.orm import Session


router = APIRouter(prefix="/read", tags=["reading_module"])

# Force reload comment


CEFR_ORDER: List[str] = ["A1", "A2", "B1", "B2", "C1", "C2"]
CAMBRIDGE_BY_CEFR: Dict[str, str] = {"A1": "KET", "A2": "KET", "B1": "PET", "B2": "FCE", "C1": "FCE", "C2": "FCE"}


class StartRequest(BaseModel):
    start_level: Optional[str] = Field(default="B1", description="Initial CEFR level A1–C2")


class SubmitRequest(BaseModel):
    session_id: str
    question_id: str
    choice_index: int


class SessionState:
    def __init__(
        self,
        session_id: str,
        username: str,
        passage: str,
        start_cefr: str,
        *,
        max_passages: int = 3,
        questions_per_passage: int = 5,
    ) -> None:
        self.session_id = session_id
        self.username = username
        self.passage = passage
        self.start_cefr = start_cefr
        self.current_cefr = start_cefr
        self.cambridge_level = CAMBRIDGE_BY_CEFR[self.current_cefr]
        self.max_passages = max_passages
        self.questions_per_passage = questions_per_passage
        self.max_questions = self.max_passages * self.questions_per_passage
        self.passage_index = 1
        self.questions_in_passage_asked = 0
        self.correct_in_passage = 0
        self.num_asked = 0
        self.correct_count = 0
        self.incorrect_count = 0
        self.correct_streak = 0
        self.incorrect_streak = 0
        self.questions: List[Dict[str, Any]] = []  # Each has: id, number, text, choices, correct_index, rationale, cefr
        self.current_passage_questions: List[Dict[str, Any]] = [] # Cached questions for the current passage
        self.current_question_index: int = 0 # Index of the current question within current_passage_questions
        self.ended = False
        self.last_outcomes: List[bool] = []  # rolling window of last N (5) outcomes across session

    def next_number(self) -> int:
        return self.num_asked + 1


_sessions: Dict[str, SessionState] = {}


def _validate_cefr(level: Optional[str]) -> str:
    if not level:
        return "B1"
    level_u = level.upper()
    if level_u not in CEFR_ORDER:
        raise HTTPException(status_code=400, detail=f"level_cefr must be one of {CEFR_ORDER}")
    return level_u


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


async def _llm_generate_passage(client: GeminiClient, cefr: str, cambridge: str) -> str:
    prompt = (
        "You are an expert ESL reading writer.\n"
        f"Write a self-contained reading passage aligned to CEFR {cefr}.\n"
        f"Target vocabulary/structures commonly seen in Cambridge {cambridge}.\n"
        "Length: 180-240 words. Use accessible, contemporary topics.\n"
        "Avoid lists or bullet points. Do not add questions or commentary.\n"
        "Output ONLY the passage text."
    )
    text = await client.generate(prompt, thinking_budget=0)
    return text.strip()


def _question_prompt(passage: str, cefr: str, cambridge: str, number: int, total: int) -> str:
    return (
        "You are generating a multiple-choice reading comprehension question.\n"
        f"Passage (verbatim):\n---\n{passage}\n---\n"
        f"Constraints: Aim for CEFR {cefr} difficulty. Use vocabulary/structures typical of Cambridge {cambridge}.\n"
        "The question must be answerable using the passage only, with one unambiguously correct answer.\n"
        f"Create question {number} of {total}. Focus on comprehension, inference, detail, or vocabulary-in-context.\n"
        "Produce EXACTLY 4 options. Only ONE option is correct.\n"
        "Return ONLY compact JSON with keys: question, options (array of 4 strings), correct_index (0-3), rationale.\n"
        "No markdown, no extra commentary."
    )


async def _llm_generate_question(client: GeminiClient, state: SessionState) -> Dict[str, Any]:
    number = state.next_number()
    prompt = _question_prompt(state.passage, state.current_cefr, state.cambridge_level, number, state.max_questions)
    raw = await client.generate(prompt, thinking_budget=0)
    data = _extract_json_object(raw)
    question_text = data.get("question")
    options = data.get("options")
    correct_index = data.get("correct_index")
    rationale = data.get("rationale")
    if not isinstance(question_text, str) or not isinstance(options, list) or len(options) != 4 or not isinstance(correct_index, int):
        raise HTTPException(status_code=500, detail="Invalid question format from LLM")
    if correct_index < 0 or correct_index > 3:
        raise HTTPException(status_code=500, detail="Invalid correct_index from LLM")
    qid = f"q{number}-{uuid.uuid4().hex[:8]}"
    question = {
        "id": qid,
        "number": number,
        "question": question_text.strip(),
        "choices": [str(o).strip() for o in options],
        "correct_index": int(correct_index),
        "rationale": str(rationale).strip() if isinstance(rationale, str) else "",
        "level_cefr": state.current_cefr,
        "cambridge_level": state.cambridge_level,
    }
    return question


async def _llm_generate_passage_questions(client: GeminiClient, state: SessionState) -> List[Dict[str, Any]]:
    prompt = (
        "You are generating 5 multiple-choice reading comprehension questions for the following passage.\n"
        f"Passage (verbatim):\n---\n{state.passage}\n---\n"
        f"Constraints: Aim for CEFR {state.current_cefr} difficulty. Use vocabulary/structures typical of Cambridge {state.cambridge_level}.\n"
        "Each question must be answerable using the passage only, with one unambiguously correct answer.\n"
        "Produce EXACTLY 4 options for each question. Only ONE option is correct.\n"
        "Return ONLY a compact JSON array of 5 question objects. Each object must have keys: question, options (array of 4 strings), correct_index (0-3), rationale.\n"
        "No markdown, no extra commentary."
    )
    raw = await client.generate(prompt, thinking_budget=0)
    data = _extract_json_object(raw)
    if not isinstance(data, list) or len(data) != state.questions_per_passage:
        raise HTTPException(status_code=500, detail="LLM did not return a valid array of 5 questions.")

    questions = []
    for i, q_data in enumerate(data):
        question_text = q_data.get("question")
        options = q_data.get("options")
        correct_index = q_data.get("correct_index")
        rationale = q_data.get("rationale")

        if not isinstance(question_text, str) or not isinstance(options, list) or len(options) != 4 or not isinstance(correct_index, int):
            raise HTTPException(status_code=500, detail=f"Invalid question format for question {i+1} from LLM")
        if correct_index < 0 or correct_index > 3:
            raise HTTPException(status_code=500, detail=f"Invalid correct_index for question {i+1} from LLM")

        qid = f"q{state.next_number() + i}-{uuid.uuid4().hex[:8]}"
        question = {
            "id": qid,
            "number": state.next_number() + i,
            "question": question_text.strip(),
            "choices": [str(o).strip() for o in options],
            "correct_index": int(correct_index),
            "rationale": str(rationale).strip() if isinstance(rationale, str) else "",
            "level_cefr": state.current_cefr,
            "cambridge_level": state.cambridge_level,
        }
        questions.append(question)
    return questions


def _step_difficulty(state: SessionState, was_correct: bool) -> None:
    if was_correct:
        state.correct_streak += 1
        state.incorrect_streak = 0
        if state.correct_streak >= 2:
            idx = CEFR_ORDER.index(state.current_cefr)
            if idx < len(CEFR_ORDER) - 1:
                state.current_cefr = CEFR_ORDER[idx + 1]
                state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
            state.correct_streak = 0
    else:
        state.incorrect_streak += 1
        state.correct_streak = 0
        if state.incorrect_streak >= 2:
            idx = CEFR_ORDER.index(state.current_cefr)
            if idx > 0:
                state.current_cefr = CEFR_ORDER[idx - 1]
                state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
            state.incorrect_streak = 0


def _adjust_final_by_last_five(current_cefr: str, outcomes: List[bool]) -> str:
    # Adjust one level up or down based on last up-to-5 answers
    if not outcomes:
        return current_cefr
    correct = sum(1 for o in outcomes[-5:] if o)
    idx = CEFR_ORDER.index(current_cefr)
    if correct >= 4:
        idx = min(idx + 1, len(CEFR_ORDER) - 1)
    elif correct <= 1:
        idx = max(idx - 1, 0)
    return CEFR_ORDER[idx]


@router.post("/session/start")
async def start_session(req: StartRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    level = _validate_cefr(req.start_level)
    session_id = uuid.uuid4().hex
    client = GeminiClient(model="gemini-2.0-flash-lite")
    try:
        passage = await _llm_generate_passage(client, level, CAMBRIDGE_BY_CEFR[level])
        state = SessionState(session_id=session_id, username=user.username, passage=passage, start_cefr=level)
        # Upsert user and read module row
        ua = db.get(UserAccount, user.username)
        if not ua:
            ua = UserAccount(username=user.username)
            db.add(ua)
        rm = db.get(ReadModule, user.username)
        if not rm:
            rm = ReadModule(username=user.username)
            db.add(rm)
        rm.last_session_id = session_id
        rm.passage_index = state.passage_index
        rm.questions_answered = 0
        rm.correct_total = 0
        rm.incorrect_total = 0
        rm.start_cefr = level
        rm.end_cefr = level
        db.commit()
        _sessions[session_id] = state
        # Generate all questions for the first passage
        all_questions = await _llm_generate_passage_questions(client, state)
        state.current_passage_questions = all_questions
        q = all_questions[0] # Get the first question
        state.questions.append(q)
        state.num_asked += 1
        state.questions_in_passage_asked = 1
        return {
            "session_id": session_id,
            "passage": passage,
            "target_cefr": state.current_cefr,
            "cambridge_level": state.cambridge_level,
            "passage_index": state.passage_index,
            "max_passages": state.max_passages,
            "questions_per_passage": state.questions_per_passage,
            "question": {
                "id": q["id"],
                "number": q["number"],
                "text": q["question"],
                "choices": q["choices"],
                "level_cefr": q["level_cefr"],
                "cambridge_level": q["cambridge_level"],
                "correct_choice_index": q["correct_index"],
                "rationale": q.get("rationale", ""),
            },
            "total_questions": state.max_questions,
        }
    finally:
        await client.aclose()


@router.post("/session/submit")
async def submit_answer(req: SubmitRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    state = _sessions.get(req.session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    if state.ended:
        raise HTTPException(status_code=400, detail="Session already ended")
    if not state.questions:
        raise HTTPException(status_code=400, detail="No question to submit")
    last_q = state.questions[-1]
    if req.question_id != last_q["id"]:
        raise HTTPException(status_code=400, detail="Question ID mismatch")
    if req.choice_index < 0 or req.choice_index > 3:
        raise HTTPException(status_code=400, detail="choice_index must be 0..3")

    was_correct = (req.choice_index == last_q["correct_index"])
    if was_correct:
        state.correct_count += 1
        state.correct_in_passage += 1
    else:
        state.incorrect_count += 1

    # Track rolling last 5 outcomes
    state.last_outcomes.append(was_correct)
    if len(state.last_outcomes) > 5:
        state.last_outcomes.pop(0)

    # Determine if this was the last question of the current passage
    end_of_passage = (state.questions_in_passage_asked >= state.questions_per_passage)

    next_question_payload: Optional[Dict[str, Any]] = None
    new_passage_text: Optional[str] = None

    # Increment current_question_index for the next question
    state.current_question_index += 1

    if end_of_passage:
        # Apply passage-level adjustment
        prev_level = state.current_cefr
        idx = CEFR_ORDER.index(state.current_cefr)
        c = state.correct_in_passage
        if c >= 5:
            idx += 2
        elif c == 4:
            if state.current_cefr == "C1":
                idx += 0
            else:
                idx += 1
        elif c == 3:
            idx += 0
        elif c == 2:
            idx -= 1
        else:  # 0 or 1 correct
            idx -= 2
        idx = max(0, min(idx, len(CEFR_ORDER) - 1))
        state.current_cefr = CEFR_ORDER[idx]
        state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
        state.passage_index += 1
        state.questions_in_passage_asked = 0
        state.correct_in_passage = 0
        state.current_question_index = 0 # Reset question index for new passage

        # If we have completed all passages, finalize session and adjust by last five
        if state.passage_index > state.max_passages:
            # Final refresh based on last five outcomes
            state.current_cefr = _adjust_final_by_last_five(state.current_cefr, state.last_outcomes)
            state.cambridge_level = CAMBRIDGE_BY_CEFR[state.current_cefr]
            state.ended = True
        else:
            # Generate next passage and all its questions
            client = GeminiClient(model="gemini-2.0-flash-lite")
            try:
                new_passage_text = await _llm_generate_passage(client, state.current_cefr, state.cambridge_level)
                state.passage = new_passage_text
                all_questions = await _llm_generate_passage_questions(client, state)
                state.current_passage_questions = all_questions
                q = all_questions[0] # Get the first question of the new passage
                state.questions.append(q)
                state.num_asked += 1
                state.questions_in_passage_asked = 1
                next_question_payload = {
                    "id": q["id"],
                    "number": q["number"],
                    "text": q["question"],
                    "choices": q["choices"],
                    "level_cefr": q["level_cefr"],
                    "cambridge_level": q["cambridge_level"],
                    "correct_choice_index": q["correct_index"],
                    "rationale": q.get("rationale", ""),
                }
            finally:
                await client.aclose()
    else:
        # Continue within the same passage, retrieve next question from cache
        if state.current_question_index < len(state.current_passage_questions):
            q = state.current_passage_questions[state.current_question_index]
            state.questions.append(q)
            state.num_asked += 1
            state.questions_in_passage_asked += 1
            next_question_payload = {
                "id": q["id"],
                "number": q["number"],
                "text": q["question"],
                "choices": q["choices"],
                "level_cefr": q["level_cefr"],
                "cambridge_level": q["cambridge_level"],
                "correct_choice_index": q["correct_index"],
                "rationale": q.get("rationale", ""),
            }
        else:
            # This case should ideally not be reached if logic is correct, but handle defensively
            raise HTTPException(status_code=500, detail="No more questions in current passage cache.")

    # Persist progress
    rm = db.get(ReadModule, user.username)
    if rm:
        rm.passage_index = state.passage_index
        rm.questions_answered = state.num_asked
        rm.correct_total = state.correct_count
        rm.incorrect_total = state.incorrect_count
        rm.end_cefr = state.current_cefr
        try:
            import json as _json
            rm.last_payload = _json.dumps({
                "passage_index": state.passage_index,
                "asked": state.num_asked,
                "correct": state.correct_count,
                "incorrect": state.incorrect_count,
                "start_cefr": state.start_cefr,
                "end_cefr": state.current_cefr,
            })
        except Exception:
            pass
        db.commit()

    return {
        "correct": was_correct,
        "correct_choice_index": last_q["correct_index"],
        "rationale": last_q.get("rationale", ""),
        "updated_target_cefr": state.current_cefr,
        "cambridge_level": state.cambridge_level,
        "streak_correct": state.correct_streak,
        "streak_incorrect": state.incorrect_streak,
        "asked": state.num_asked,
        "remaining": max(0, state.max_questions - state.num_asked),
        "finished": state.ended,
        "summary": (
            {
                "total": state.max_questions,
                "correct": state.correct_count,
                "incorrect": state.incorrect_count,
                "start_cefr": state.start_cefr,
                "end_cefr": state.current_cefr,
            }
            if state.ended
            else None
        ),
        "passage_index": min(state.passage_index, state.max_passages),
        "max_passages": state.max_passages,
        "questions_per_passage": state.questions_per_passage,
        "new_passage": new_passage_text,
        "next_question": next_question_payload,
    }


@router.get("/session/state")
async def get_state(session_id: str, user: User = Depends(get_current_user)):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": state.session_id,
        "passage": state.passage,
        "target_cefr": state.current_cefr,
        "cambridge_level": state.cambridge_level,
        "passage_index": state.passage_index,
        "max_passages": state.max_passages,
        "questions_per_passage": state.questions_per_passage,
        "questions_in_passage_asked": state.questions_in_passage_asked,
        "correct_in_passage": state.correct_in_passage,
        "asked": state.num_asked,
        "correct": state.correct_count,
        "incorrect": state.incorrect_count,
        "finished": state.ended,
        "last_question": (
            {
                "id": state.questions[-1]["id"],
                "number": state.questions[-1]["number"],
                "text": state.questions[-1]["question"],
                "choices": state.questions[-1]["choices"],
            }
            if state.questions
            else None
        ),
    }


@router.get("/summary")
async def get_summary(session_id: str, user: User = Depends(get_current_user)):
    state = _sessions.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    # If not ended, provide current snapshot; if ended, it's the final
    end_cefr = state.current_cefr if state.ended else _adjust_final_by_last_five(state.current_cefr, state.last_outcomes)
    return {
        "session_id": state.session_id,
        "finished": state.ended,
        "total": state.max_questions,
        "asked": state.num_asked,
        "correct": state.correct_count,
        "incorrect": state.incorrect_count,
        "start_cefr": state.start_cefr,
        "end_cefr": end_cefr,
        "cambridge_level": CAMBRIDGE_BY_CEFR[end_cefr],
    }