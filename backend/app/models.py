from __future__ import annotations
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, UniqueConstraint
from .db import Base


class AuthUser(Base):
	__tablename__ = "auth_users"
	# Primary key is username
	username = Column(String(128), primary_key=True, index=True)
	password_hash = Column(String(256), nullable=False)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class UserAccount(Base):
	__tablename__ = "user_accounts"
	# Primary key is username for simplicity (unique single identifier)
	username = Column(String(128), primary_key=True, index=True)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ReadModule(Base):
	__tablename__ = "read_module"
	username = Column(String(128), primary_key=True)
	# Single entry per username; stores last session summary and metadata
	last_session_id = Column(String(64), nullable=True)
	passage_index = Column(Integer, default=0, nullable=False)
	questions_answered = Column(Integer, default=0, nullable=False)
	correct_total = Column(Integer, default=0, nullable=False)
	incorrect_total = Column(Integer, default=0, nullable=False)
	start_cefr = Column(String(8), nullable=True)
	end_cefr = Column(String(8), nullable=True)
	last_payload = Column(Text, nullable=True)  # JSON string snapshot
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WriteModule(Base):
	__tablename__ = "write_module"
	username = Column(String(128), primary_key=True)
	last_prompt = Column(Text, nullable=True)
	last_score_json = Column(Text, nullable=True)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ListenModule(Base):
	__tablename__ = "listen_module"
	username = Column(String(128), primary_key=True)
	last_session_json = Column(Text, nullable=True)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class VocabularyModule(Base):
	__tablename__ = "vocabulary_module"
	username = Column(String(128), primary_key=True)
	last_session_json = Column(Text, nullable=True)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class SpeakingModule(Base):
	__tablename__ = "speaking_module"
	username = Column(String(128), primary_key=True)
	last_session_json = Column(Text, nullable=True)
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


