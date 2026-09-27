# CS Assistant - internal site for the Company Secretariat & Legal team.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CS_DATA_DIR=/data PORT=8080
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn==23.*

COPY . .
RUN useradd --system --uid 1001 csapp && mkdir -p /data && chown -R csapp /data
USER csapp

VOLUME ["/data"]
EXPOSE 8080

# One process (uploaded files for a question are held in memory) with many threads.
# No timeout: long document reviews stream for several minutes.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "32", \
     "--worker-class", "gthread", "--timeout", "0", "--access-logfile", "-", "app:app"]
