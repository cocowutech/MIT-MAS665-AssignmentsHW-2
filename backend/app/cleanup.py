from __future__ import annotations
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .models import UserAccount, ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule


def purge_older_than_one_week(db: Session) -> int:
\tthreshold = datetime.utcnow() - timedelta(days=7)
\t# Only remove module rows whose updated_at < threshold AND no recent user update
\t# Users themselves: if user.updated_at < threshold and there are no module updates newer than threshold, remove user as well
\tremoved = 0

\tfor model in (ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule):
\t\tres = db.execute(delete(model).where(model.updated_at < threshold))
\t\tremoved += res.rowcount or 0

\t# Remove dormant users (older than threshold) that have no corresponding module rows
\tstale_users = db.query(UserAccount).filter(UserAccount.updated_at < threshold).all()
\tfor u in stale_users:
\t\t# Check if user has any recent module row remaining
\t\thas_rows = False
\t\tfor model in (ReadModule, WriteModule, ListenModule, VocabularyModule, SpeakingModule):
\t\t\trow = db.query(model).filter(model.username == u.username).first()
\t\t\tif row is not None:
\t\t\t\thas_rows = True
\t\t\t\tbreak
\t\tif not has_rows:
\t\t\tres = db.execute(delete(UserAccount).where(UserAccount.username == u.username))
\t\t\tremoved += res.rowcount or 0

\tdb.commit()
\treturn removed


