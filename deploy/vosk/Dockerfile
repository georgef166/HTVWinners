FROM python:3.12-slim
RUN pip install --no-cache-dir vosk==0.3.45 websockets==13.1
# Vosk's small English model (40 MB): built for fast streaming on CPU.
ADD https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip /tmp/model.zip
RUN python -m zipfile -e /tmp/model.zip /tmp && mv /tmp/vosk-model-small-en-us-0.15 /model && rm /tmp/model.zip
COPY server.py /server.py
EXPOSE 2700
CMD ["python", "-u", "/server.py"]
