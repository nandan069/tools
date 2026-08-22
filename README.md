# Video Processor Tool

This is a comprehensive full-stack video processing application. It features a React-based frontend and a robust Node.js backend powered by FFmpeg, BullMQ, and Redis to handle heavy asynchronous video processing workloads.

## Features
- **Video Transformation**: Trim, crop, rotate, change speed, and convert FPS.
- **Visual Effects**: Add watermarks, film grain, dynamic zoom, hue rotation, split-screen overlays, and face/privacy blurring.
- **Audio Manipulation**: Pitch shifting, noise floor adjustment, EQ shifts, and volume control.
- **AI & Captions**: Auto-subtitles via Whisper AI integration.
- **Metadata Management**: Edit or remove video metadata securely.

## Project Structure
- `video-processor/`: The frontend application built with React and Vite. It provides a dynamic user interface to configure video transformations.
- `video-processor-backend/`: The backend API built with Node.js and Express. It uses BullMQ backed by Redis for job queuing and fluent-ffmpeg for actual video processing.

## Prerequisites
Ensure you have the following installed on your local machine:
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Docker & Docker Compose](https://www.docker.com/) (Required for running the Redis service)
- [FFmpeg](https://ffmpeg.org/) (If you plan to run the backend natively without Docker)

## How to Run Locally

### 1. Start the Backend & Redis

The backend requires a Redis instance to handle job queues via BullMQ. The easiest way to get this running is using the provided Docker Compose configuration.

Open a terminal and navigate to the backend directory:
```bash
cd video-processor-backend
```

Install the backend dependencies (this will also run post-install scripts to download necessary fonts and Whisper binaries):
```bash
npm install
```

Start the Redis container in the background:
```bash
docker-compose up -d redis
```

Start the backend development server:
```bash
npm run dev
```
The backend API will now be running on `http://localhost:3001`.

*(Alternatively, you can run the entire backend + Redis stack via Docker by just running `docker-compose up -d`)*

### 2. Start the Frontend

Open a new terminal window and navigate to the frontend directory:
```bash
cd video-processor
```

Install the frontend dependencies:
```bash
npm install
```

Start the Vite development server:
```bash
npm run dev
```
The frontend application will now be running (usually on `http://localhost:5173`).

## Environment Variables (Optional)
Both the frontend and backend have `.env.example` files. If you need to override default settings (like the API URL or ports), you can copy these to `.env` and modify them as needed.

- **Frontend**: Copy `video-processor/.env.example` to `video-processor/.env.local` to configure `VITE_API_URL` if your backend is running on a different URL/port.
- **Backend**: Copy `video-processor-backend/.env.example` to `video-processor-backend/.env` to configure variables like `PORT` or `REDIS_URL`.
