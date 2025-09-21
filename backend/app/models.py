from __future__ import annotations
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Text, UniqueConstraint
from .db import Base


class UserAccount(Base):
\t__tablename__ = "user_accounts"
\t# Primary key is username for simplicity (unique single identifier)
\tusername = Column(String(128), primary_key=True, index=True)
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ReadModule(Base):
\t__tablename__ = "read_module"
\tusername = Column(String(128), primary_key=True)
\t# Single entry per username; stores last session summary and metadata
\tlast_session_id = Column(String(64), nullable=True)
\tpassage_index = Column(Integer, default=0, nullable=False)
\tquestions_answered = Column(Integer, default=0, nullable=False)
\tcorrect_total = Column(Integer, default=0, nullable=False)
\tincorrect_total = Column(Integer, default=0, nullable=False)
\tstart_cefr = Column(String(8), nullable=True)
\tend_cefr = Column(String(8), nullable=True)
\tlast_payload = Column(Text, nullable=True)  # JSON string snapshot
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class WriteModule(Base):
\t__tablename__ = "write_module"
\tusername = Column(String(128), primary_key=True)
\tlast_prompt = Column(Text, nullable=True)
\tlast_score_json = Column(Text, nullable=True)
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class ListenModule(Base):
\t__tablename__ = "listen_module"
\tusername = Column(String(128), primary_key=True)
\tlast_session_json = Column(Text, nullable=True)
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class VocabularyModule(Base):
\t__tablename__ = "vocabulary_module"
\tusername = Column(String(128), primary_key=True)
\tlast_session_json = Column(Text, nullable=True)
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class SpeakingModule(Base):
\t__tablename__ = "speaking_module"
\tusername = Column(String(128), primary_key=True)
\tlast_session_json = Column(Text, nullable=True)
\tcreated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
\tupdated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


