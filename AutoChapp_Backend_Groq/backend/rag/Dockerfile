FROM python:3.12-slim
WORKDIR /srv
RUN pip install --no-cache-dir "Flask>=3,<4" "gunicorn>=22,<24"
COPY server.py .
CMD ["gunicorn","-w","2","-b","0.0.0.0:8090","server:app"]
