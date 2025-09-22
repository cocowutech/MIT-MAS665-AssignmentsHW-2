from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from ..gemini_client import GeminiClient
from .auth import get_current_user, User
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AuthUser

router = APIRouter(prefix="/gemini", tags=["gemini"])

class GenerateRequest(BaseModel):
	prompt: str

@router.post("/generate")
async def generate(req: GenerateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
	try:
		# Enforce per-user request limits
		row = db.query(AuthUser).filter(AuthUser.username == user.username).first()
		if row:
			if row.requests_used >= row.requests_limit:
				raise HTTPException(status_code=429, detail="request limit reached")
			row.requests_used += 1
			db.add(row)
			db.commit()
		client = GeminiClient()
		text = await client.generate(req.prompt)
		await client.aclose()
		return {"text": text}
	except Exception as e:
		raise HTTPException(status_code=500, detail=str(e))
