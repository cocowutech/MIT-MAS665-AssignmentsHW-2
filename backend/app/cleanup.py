from __future__ import annotations
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import UserAccount, ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule


def purge_older_than_one_week(db: Session) -> int:
	threshold = datetime.utcnow() - timedelta(days=7)
	# Only remove module rows whose updated_at < threshold AND no recent user update
	# Users themselves: if user.updated_at < threshold and there are no module updates newer than threshold, remove user as well
	removed = 0

	for model in (ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule):
		res = db.execute(delete(model).where(model.updated_at < threshold))
		removed += res.rowcount or 0

	# Remove dormant users (older than threshold) that have no corresponding module rows
	stale_users = db.query(UserAccount).filter(UserAccount.updated_at < threshold).all()
	for u in stale_users:
		# Check if user has any recent module row remaining
		has_rows = False
		for model in (ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule):
			row = db.query(model).filter(model.username == u.username).first()
			if row is not None:
				has_rows = True
				break
		if not has_rows:
			res = db.execute(delete(UserAccount).where(UserAccount.username == u.username))
			removed += res.rowcount or 0

	db.commit()
	return removed


