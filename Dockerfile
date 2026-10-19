FROM python:3.12-slim
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY backend ./backend
COPY prompts ./prompts
RUN useradd --uid 10001 --create-home appuser
USER appuser
ENV NF_MODE=production NF_AI_MODE=live PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
