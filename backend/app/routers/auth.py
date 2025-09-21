from datetime import datetime, timedelta, timezone
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from ..settings import settings
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AuthUser

router = APIRouter(prefix="/auth", tags=["auth"])

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")


class Token(BaseModel):
	access_token: str
	token_type: str = "bearer"


class User(BaseModel):
	username: str


_users: Dict[str, str] = {}


def _ensure_seed_user() -> None:
	username = settings.seed_username
	password = settings.seed_password_plain
	if username and password and username not in _users:
		_users[username] = pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
	return pwd_context.verify(plain_password, hashed_password)


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
	# Try DB-backed users first
	user_row = db.query(AuthUser).filter(AuthUser.username == username).first()
	if user_row and verify_password(password, user_row.password_hash):
		return User(username=username)
	# Fallback to seed in-memory user for dev convenience
	_ensure_seed_user()
	hashed = _users.get(username)
	if hashed and verify_password(password, hashed):
		return User(username=username)
	return None


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
	to_encode = data.copy()
	expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
	to_encode.update({"exp": expire})
	encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
	return encoded_jwt


@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
	user = authenticate_user(db, form_data.username, form_data.password)
	if not user:
		raise HTTPException(status_code=401, detail="Incorrect username or password")
	access_token = create_access_token({"sub": user.username})
	return Token(access_token=access_token)


def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
	credentials_exception = HTTPException(status_code=401, detail="Could not validate credentials")
	try:
		payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
		username: str | None = payload.get("sub")
		if username is None:
			raise credentials_exception
	except JWTError:
		raise credentials_exception
	return User(username=username)


class RegisterRequest(BaseModel):
	username: str
	password: str


@router.post("/register", status_code=201)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
	username = (req.username or "").strip()
	password = req.password or ""
	if not username or not password:
		raise HTTPException(status_code=400, detail="username and password are required")
	if len(username) < 3 or len(username) > 128:
		raise HTTPException(status_code=400, detail="username must be 3-128 characters")
	# Check exists
	existing = db.query(AuthUser).filter(AuthUser.username == username).first()
	if existing:
		raise HTTPException(status_code=409, detail="username already exists")
	# Create user
	row = AuthUser(username=username, password_hash=pwd_context.hash(password))
	db.add(row)
	db.commit()
	return {"ok": True}


