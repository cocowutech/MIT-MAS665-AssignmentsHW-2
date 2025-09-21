from datetime import datetime, timedelta, timezone
from typing import Optional, Dict

from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm, OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from ..settings import settings

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


def authenticate_user(username: str, password: str) -> Optional[User]:
	_ensure_seed_user()
	hashed = _users.get(username)
	if not hashed or not verify_password(password, hashed):
		return None
	return User(username=username)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
	to_encode = data.copy()
	expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
	to_encode.update({"exp": expire})
	encoded_jwt = jwt.encode(to_encode, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
	return encoded_jwt


@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
	user = authenticate_user(form_data.username, form_data.password)
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


