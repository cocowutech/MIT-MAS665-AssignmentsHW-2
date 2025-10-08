from datetime import datetime, timedelta, timezone
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
import logging

from ..settings import settings
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import AuthUser, AuthSession

router = APIRouter(prefix="/auth", tags=["auth"])

logging.getLogger('passlib').setLevel(logging.ERROR)
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
		# Truncate password to 72 bytes for bcrypt compatibility
		password_bytes = password.encode('utf-8')
		if len(password_bytes) > 72:
			password_bytes = password_bytes[:72]
		_users[username] = pwd_context.hash(password_bytes.decode('utf-8', errors='ignore'))


def verify_password(plain_password: str, hashed_password: str) -> bool:
	return pwd_context.verify(plain_password, hashed_password)


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
	# Check for guest users (case-insensitive)
	if username.lower() in ['guest', 'guests']:
		return User(username=username.lower())
	
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


def _resolve_expiry(expires_delta: Optional[timedelta]) -> datetime:
	"""Return a safe JWT expiry timestamp.

	The previous implementation attempted a ~10k year lifetime, which overflowed
	`datetime` for some platforms. We now respect the configured session timeout
	when provided, and fall back to a generous but finite default.
	"""
	delta = expires_delta
	if delta is None:
		minutes = getattr(settings, "access_token_expire_minutes", None)
		if isinstance(minutes, int) and minutes > 0:
			delta = timedelta(minutes=minutes)
		else:
			delta = timedelta(days=30)
	now = datetime.now(timezone.utc)
	try:
		return now + delta
	except OverflowError:
		# Cap at far future but within datetime bounds
		return datetime.max.replace(tzinfo=timezone.utc)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
	to_encode = data.copy()
	expire = _resolve_expiry(expires_delta)
	to_encode.update({"exp": expire})
	encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
	return encoded_jwt


@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
	user = authenticate_user(db, form_data.username, form_data.password)
	if not user:
		raise HTTPException(status_code=401, detail="Incorrect username or password")
	# Create a new session id (jti) and persist server-side
	import uuid
	session_id = uuid.uuid4().hex
	access_token = create_access_token({"sub": user.username, "jti": session_id})
	# Upsert session row
	try:
		row = AuthSession(session_id=session_id, username=user.username)
		db.merge(row)
		db.commit()
	except Exception:
		db.rollback()
	return Token(access_token=access_token)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
	credentials_exception = HTTPException(status_code=401, detail="Could not validate credentials")
	try:
		payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
		username: str | None = payload.get("sub")
		jti: str | None = payload.get("jti")
		if username is None or jti is None:
			raise credentials_exception
	except JWTError:
		raise credentials_exception
	# Enforce inactivity timeout of 24 hours
	# No inactivity timeout enforced as per user request.
	# The token itself now has a very long expiration.
	# We still check if the session exists in the DB to ensure it wasn't explicitly revoked (e.g., by admin).
	try:
		row = db.get(AuthSession, jti)
		if not row or row.username != username:
			raise credentials_exception
		# Update last activity (touch) - still useful for tracking active sessions, but not for expiration
		row.last_activity_at = datetime.utcnow()
		db.add(row)
		db.commit()
	except HTTPException:
		raise
	except Exception:
		# On DB errors, fail closed
		raise credentials_exception
	return User(username=username)


@router.get("/me", response_model=User)
async def me(user: User = Depends(get_current_user)):
	return user


class RegisterRequest(BaseModel):
	username: str
	password: str
	email: str
	phone: str


@router.post("/register", status_code=201)
async def register(req: RegisterRequest, db: Session = Depends(get_db)):
	username = (req.username or "").strip()
	password = req.password or ""
	email = (req.email or "").strip()
	phone = (req.phone or "").strip()
	if not username or not password:
		raise HTTPException(status_code=400, detail="username and password are required")
	if not email or not phone:
		raise HTTPException(status_code=400, detail="email and phone are required")
	if len(username) < 3 or len(username) > 128:
		raise HTTPException(status_code=400, detail="username must be 3-128 characters")
	# Check exists
	existing = db.query(AuthUser).filter(AuthUser.username == username).first()
	if existing:
		raise HTTPException(status_code=409, detail="username already exists")
	# Create user
	limit = 1000000 if username == "rong_wu" else 1000
	row = AuthUser(username=username, password_hash=pwd_context.hash(password), email=email, phone=phone, requests_limit=limit)
	db.add(row)
	db.commit()
	return {"ok": True}
