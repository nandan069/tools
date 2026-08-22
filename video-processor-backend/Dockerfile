FROM node:18-bullseye-slim

# Configure apt retries to handle unstable Debian mirrors
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80-retries && \
    echo 'Acquire::http::Timeout "60";' >> /etc/apt/apt.conf.d/80-retries && \
    echo 'Acquire::ftp::Timeout "60";' >> /etc/apt/apt.conf.d/80-retries && \
    apt-get update && apt-get install -y --fix-missing \
    ffmpeg \
    cmake \
    build-essential \
    python3 \
    python3-pip \
    python3-opencv \
    fonts-liberation \
    fontconfig \
    git \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir onnxruntime opencv-python-headless


WORKDIR /app

COPY package.json package-lock.json ./
COPY download-font.js build-whisper.js ./
RUN npm ci

# Pre-download the Whisper base model to avoid runtime downloading issues
RUN cd node_modules/nodejs-whisper/cpp/whisper.cpp/models && sh ./download-ggml-model.sh base


COPY . .

EXPOSE 3001

CMD ["npm", "start"]
