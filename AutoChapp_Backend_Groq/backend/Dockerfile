FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY wsgi.py .
EXPOSE 5800
CMD ["gunicorn","-w","2","-b","0.0.0.0:5800","--timeout","90","wsgi:app"]
