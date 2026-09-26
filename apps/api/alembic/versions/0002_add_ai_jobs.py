"""0002_add_ai_jobs

Revision ID: 0002_add_ai_jobs
Revises: 0001_initial_schema
Create Date: 2026-09-26 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002_add_ai_jobs'
down_revision: Union[str, Sequence[str], None] = '0001_initial_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ai_jobs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('classroom_id', sa.String(), nullable=True),
        sa.Column('job_type', sa.String(), nullable=False),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_attempts', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('payload', sa.Text(), nullable=False, server_default='{}'),
        sa.Column('result', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_ai_jobs_user_id'), 'ai_jobs', ['user_id'], unique=False)
    op.create_index(op.f('ix_ai_jobs_classroom_id'), 'ai_jobs', ['classroom_id'], unique=False)
    op.create_index(op.f('ix_ai_jobs_job_type'), 'ai_jobs', ['job_type'], unique=False)
    op.create_index(op.f('ix_ai_jobs_status'), 'ai_jobs', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ai_jobs_status'), table_name='ai_jobs')
    op.drop_index(op.f('ix_ai_jobs_job_type'), table_name='ai_jobs')
    op.drop_index(op.f('ix_ai_jobs_classroom_id'), table_name='ai_jobs')
    op.drop_index(op.f('ix_ai_jobs_user_id'), table_name='ai_jobs')
    op.drop_table('ai_jobs')
