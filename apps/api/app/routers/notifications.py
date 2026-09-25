from datetime import datetime, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import EnrollmentRow, NotificationRow, get_db
from app.core.security import require_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _format_notification(n: NotificationRow) -> dict[str, Any]:
    return {
        "id": n.id,
        "recipientId": n.recipient_id,
        "classroomId": n.classroom_id,
        "type": n.type,
        "title": n.title,
        "message": n.message,
        "relatedEntityType": n.related_entity_type or "",
        "relatedEntityId": n.related_entity_id or "",
        "createdAt": n.created_at.isoformat() if n.created_at else datetime.now(timezone.utc).isoformat(),
        "readAt": n.read_at.isoformat() if n.read_at else None,
        "isRead": n.read_at is not None,
    }


async def create_classroom_notifications(
    db: AsyncSession,
    classroom_id: str,
    notif_type: str,
    title: str,
    message: str,
    related_entity_type: str,
    related_entity_id: str,
) -> int:
    """
    Creates user-specific notifications for all students enrolled in the classroom.
    Idempotent: prevents duplicate notifications for the same recipient, type, and entity.
    """
    student_ids = (
        await db.scalars(
            select(EnrollmentRow.student_id).where(EnrollmentRow.classroom_id == classroom_id)
        )
    ).all()

    created_count = 0
    for sid in student_ids:
        # Check idempotency
        existing = await db.scalar(
            select(NotificationRow).where(
                NotificationRow.recipient_id == sid,
                NotificationRow.type == notif_type,
                NotificationRow.related_entity_id == related_entity_id,
            )
        )
        if not existing:
            notif = NotificationRow(
                id=f"notif-{uuid.uuid4().hex[:10]}",
                recipient_id=sid,
                classroom_id=classroom_id,
                type=notif_type,
                title=title,
                message=message,
                related_entity_type=related_entity_type,
                related_entity_id=related_entity_id,
                created_at=datetime.now(timezone.utc),
                read_at=None,
            )
            db.add(notif)
            created_count += 1

    await db.commit()
    return created_count


@router.get("")
async def list_notifications(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = token_payload.get("sub", "")
    rows = (
        await db.scalars(
            select(NotificationRow)
            .where(NotificationRow.recipient_id == user_id)
            .order_by(NotificationRow.created_at.desc())
        )
    ).all()
    return [_format_notification(r) for r in rows]


@router.get("/unread-count")
async def get_unread_count(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = token_payload.get("sub", "")
    count = await db.scalar(
        select(func.count(NotificationRow.id)).where(
            NotificationRow.recipient_id == user_id,
            NotificationRow.read_at.is_(None),
        )
    )
    return {"count": count or 0}


@router.patch("/{notification_id}/read")
async def mark_as_read(
    notification_id: str,
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = token_payload.get("sub", "")
    notif = await db.scalar(select(NotificationRow).where(NotificationRow.id == notification_id))
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notif.recipient_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not notif.read_at:
        notif.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notif)

    return _format_notification(notif)


@router.post("/read-all")
async def mark_all_as_read(
    token_payload: dict = Depends(require_user),
    db: AsyncSession = Depends(get_db),
):
    user_id = token_payload.get("sub", "")
    now = datetime.now(timezone.utc)
    await db.execute(
        update(NotificationRow)
        .where(
            NotificationRow.recipient_id == user_id,
            NotificationRow.read_at.is_(None),
        )
        .values(read_at=now)
    )
    await db.commit()
    return {"status": "ok"}
