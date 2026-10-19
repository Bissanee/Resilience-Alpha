FROM python:3.12-alpine
WORKDIR /app
COPY server.py .
USER nobody
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'])"
CMD ["python", "server.py"]
