from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from ..gemini_client import GeminiClient
from .auth import get_current_user, User

router = APIRouter(prefix="/gemini", tags=["gemini"])

class GenerateRequest(BaseModel):
	prompt: str

@router.post("/generate")
async def generate(req: GenerateRequest, user: User = Depends(get_current_user)):
	try:
		client = GeminiClient()
		text = await client.generate(req.prompt)
		await client.aclose()
		return {"text": text}
	except Exception as e:
		raise HTTPException(status_code=500, detail=str(e))
