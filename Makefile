.PHONY: dev api student teacher codegen test
dev:
	(cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000) & (cd synapsefrontendlovable && npm run dev)
api:
	cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000
student:
	pnpm dev:student
teacher:
	pnpm dev:teacher
codegen:
	pnpm codegen
test:
	pnpm -r test && cd apps/api && pytest
