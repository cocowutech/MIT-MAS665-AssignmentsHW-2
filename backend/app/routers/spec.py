from fastapi import APIRouter

router = APIRouter(prefix="/spec", tags=["spec"]) 

SPEC_JSON = {
	"problem": "Manual new-student assessment doesn’t scale and is inconsistent; current third-party tests don’t align tightly with KET/PET/FCE pedagogy.",
	"goal": "Automated, adaptive, ~20–25-minute placement outputting CEFR band + KET/PET/FCE readiness with sub-scores and recommendations.",
	"users": {
		"student": "Place me quickly without anxiety; give me fair, actionable feedback.",
		"parent": "Understand level & next step; see credible rubric and sample errors.",
		"teacher_admin": "Onboard students in minutes with consistent, evidence-based placement & CRM-ready record."
	},
	"scope": {
		"reading_mvp": "15 adaptive questions; difficulty steps up/down by response streaks; passages mapped to CEFR A2–C1 and KET/PET/FCE targets.",
		"speaking_mvp": "3 prompts sequenced by reading score; 30s prep + 60s record; auto-scored on lexis, grammar, fluency, coherence, task achievement.",
		"writing_mvp": "1 prompt aligned to estimated CEFR band; text or image + OCR; LLM rubric scoring + inline comments.",
		"listening_v1": "3 short clips, MCQ; aligns to CEFR & exam task types."
	},
	"functional_requirements": {
		"adaptive_engine": [
			"Item bank with CEFR tags, topic tags, difficulty logits; 2PL IRT light or simple staircase (±1 level after 2–3 correct/incorrect).",
			"Stop rules: 15 items or standard-error threshold."
		],
		"scoring": [
			"Reading: IRT/theta → CEFR mapping.",
			"Speaking: ASR → text + prosody/fluency features; LLM rubric scoring; confidence banding.",
			"Writing: OCR (if needed) → LLM rubric scoring + inline comments."
		],
		"reports": [
			"Dashboard: overall CEFR, KET/PET/FCE readiness, sub-score radar, exemplar errors, next steps, recommended course."
		],
		"content_authoring": [
			"Upload seed articles (50–60) → generator creates variants (length, distractors, question types).",
			"Prompted templates to enforce KET/PET/FCE task formats."
		],
		"admin_ops": [
			"Cohort links, attempt history, export to CSV/Sheets/CRM."
		]
	},
	"non_functional": [
		"Test length ≤ 25 min; mobile-friendly; data privacy (COPPA/GDPR-style), parental consent; store audio for model improvement with opt-in."
	],
	"rubrics": {
		"reading": ["global comprehension", "inference", "detail", "vocabulary in context"],
		"speaking": ["task achievement", "grammatical accuracy", "lexical range", "fluency (WPM + pauses)", "discourse markers"],
		"writing": ["task response", "coherence/cohesion", "grammar control", "vocabulary range", "penalties (off-topic, too short)"]
	},
	"content_kb": {
		"seed_texts": "Topics across CEFR bands (school life, travel, routines, simple arguments).",
		"item_templates": ["T/F/NG", "single best answer", "sentence insertion", "matching headings"],
		"prompt_libraries": "Constrained prompts enforcing CEFR-appropriate lexis/structures.",
		"scoring_rubrics": "CEFR-aligned bands (A2–B2) with anchors and exemplars.",
		"gold_set": "50 hand-scored speaking/writing samples for calibration and QA."
	},
	"success_metrics": {
		"placement_time_p50_minutes": "≤ 22",
		"student_satisfaction": ">= 4.3/5",
		"reading_test_retest_r": ">= 0.8",
		"convergent_validity_kappa": ">= 0.7",
		"conversion_to_correct_class": "maximize"
	}
}

SPEC_MARKDOWN = """
## Problem & Goal

Problem: Manual new-student assessment doesn’t scale and is inconsistent; current third-party tests don’t align tightly with your KET/PET/FCE pedagogy.

Goal: An automated, adaptive, ~20–25-minute placement that outputs a CEFR band and KET/PET/FCE readiness with specific sub-scores and learning recommendations.

## Primary users & jobs-to-be-done

- Student (8–16 y/o): “Place me quickly without anxiety; give me fair, actionable feedback.”
- Parent: “Understand level & next step; see credible rubric and sample errors.”
- Teacher/Admin (you): “Onboard students in minutes with consistent, evidence-based placement & CRM-ready record.”

## Scope (MVP → V1)

- Reading (MVP): 15 adaptive questions; item difficulty steps up/down by response streaks; passages mapped to CEFR A2–C1 and to KET/PET/FCE target vocab/structures.
- Speaking (MVP): 3 prompts sequenced by the reading score; 30s prep + 60s record; auto-scored on lexis, grammar, fluency, coherence, task achievement.
- Writing (MVP): 1 prompt aligned to the estimated CEFR band; image or text input; OCR → scoring on content, organization, language control, range; return annotated feedback.
- Listening (V1+): 3 short clips, multiple-choice; aligns to CEFR & exam task types.

## Detailed requirements

### Functional

#### Adaptive engine
- Item bank with CEFR tags, topic tags, difficulty logits; 2-parameter IRT light or simple staircase (±1 level after 2–3 correct/incorrect).
- Stop rules: 15 items or standard-error threshold.

#### Scoring
- Reading: IRT/theta → CEFR mapping.
- Speaking: ASR → text + prosody/fluency features; LLM rubric scoring; confidence banding.
- Writing: OCR (if needed) → LLM rubric scoring + inline comments.

#### Reports
- Dashboard: overall CEFR, KET/PET/FCE readiness, sub-score radar, exemplar errors, next steps, recommended course.

#### Content authoring
- Upload seed articles (50–60) → generator creates variants (length, distractors, question types).
- Prompted templates to enforce KET/PET/FCE task formats.

#### Admin/ops
- Cohort links, attempt history, export to CSV/Sheets/CRM.

### Non-functional
- Test length ≤ 25 min; mobile-friendly; data privacy (COPPA/GDPR-style), parental consent; store audio for model improvement with opt-in.

### Rubrics (anchor descriptors)
- Reading: global comprehension, inference, detail, vocabulary in context.
- Speaking: task achievement, grammatical accuracy, lexical range, fluency (WPM + pauses), discourse markers.
- Writing: task response, coherence/cohesion, grammar control, vocabulary range; penalty rules (off-topic, too short).

### Content & knowledge base
- Seed texts across topics at graded CEFR bands.
- Item templates: True/False/NG, single best answer, sentence insertion, matching headings; distractor patterns.
- Prompt libraries enforcing CEFR-appropriate lexis/structures when generating.
- Scoring rubrics (A2–B2) with anchors and exemplars.
- Gold set: 50 hand-scored speaking/writing samples for calibration and QA.

### Success metrics
- Placement time (p50 ≤ 22m), student satisfaction (≥ 4.3/5), test–retest reliability (ρ ≥ 0.8 on reading), convergent validity vs. teacher judgment (κ ≥ 0.7), and conversion to correct class track.
"""

@router.get("")
def get_spec_json():
	return SPEC_JSON

@router.get("/markdown")
def get_spec_markdown():
	return SPEC_MARKDOWN


