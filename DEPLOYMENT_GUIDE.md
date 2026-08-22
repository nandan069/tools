# Comprehensive Deployment Guide: Video Processor

This guide covers the complete deployment of both the **Frontend** (React/Vite) and **Backend** (Node.js/Docker) on a single Linux VPS (Ubuntu/Debian) to minimize costs while maximizing the performance of your 2 vCPU / 8 GB RAM server.

## Prerequisites
1. A fresh **Ubuntu 22.04 / 24.04** or Debian VPS.
2. A domain name (e.g., `srv1881496.hstgr.cloud`).
3. Your domain's DNS A-record pointed to the IP address of your VPS.

---

## Step 1: Server Security & Firewall (UFW)
Log into your VPS via SSH and secure the server.

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install UFW (Uncomplicated Firewall)
sudo apt install ufw -y

# Allow essential ports
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (required for Certbot SSL)
sudo ufw allow 443/tcp  # HTTPS

# Enable the firewall (This blocks Redis port 6379 from hackers)
sudo ufw enable
```

---

## Step 2: Install System Dependencies
You need Docker for the backend API and Nginx to serve the frontend and proxy API requests.

```bash
# Install Docker & Docker Compose
sudo apt install docker.io docker-compose -y
sudo systemctl enable docker
sudo systemctl start docker

# Install Nginx, Certbot, and Node/NPM (for building the frontend)
sudo apt install nginx certbot python3-certbot-nginx npm -y

# Install Node.js v20 (Recommended for Vite builds)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## Step 3: Deploy the Backend (API & Redis)
Upload your `video-processor-backend` folder to the server, typically into `/srv1881496.hstgr.cloud/video-processor-backend`.

```bash
cd /srv1881496.hstgr.cloud/video-processor-backend

# Set the CORS environment variable to your domain
echo "FRONTEND_URL=https://srv1881496.hstgr.cloud" > .env

# Start the backend services in detached mode
sudo docker-compose up -d --build
```
*Note: Docker is configured with `restart: always`, so the API and Redis will automatically restart if the VPS reboots.*

---

## Step 4: Build the Frontend (React/Vite)
Upload your `video-processor` (frontend) folder to the server, typically into `/srv1881496.hstgr.cloud/video-processor`.

```bash
cd /srv1881496.hstgr.cloud/video-processor

# Install frontend dependencies
npm install

# Set the API URL for production (This bakes the URL into the static files)
echo "VITE_API_URL=https://srv1881496.hstgr.cloud/api" > .env.production

# Build the production static files (Outputs to the /dist folder)
npm run build
```

---

## Step 5: Configure Nginx (Web Server & Reverse Proxy)
We will use Nginx to serve the static frontend files and proxy `/api/` requests to the Docker backend.

Create a new Nginx configuration file:
```bash
sudo nano /etc/nginx/sites-available/srv1881496.hstgr.cloud
```

Paste the following configuration:
```nginx
server {
    listen 80;
    server_name srv1881496.hstgr.cloud;

    # Backend API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Proper IP Forwarding for Rate Limiter
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for Long Video Processing
        proxy_connect_timeout 600s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;
        send_timeout 600s;
    }

    # Frontend Static Files
    location / {
        root /srv1881496.hstgr.cloud/video-processor/dist;
        try_files $uri $uri/ /index.html;
    }

    # Support Large File Uploads (up to 500MB)
    client_max_body_size 500M;
}
```

Enable the site and restart Nginx:
```bash
# Enable the configuration
sudo ln -s /etc/nginx/sites-available/srv1881496.hstgr.cloud /etc/nginx/sites-enabled/

# Remove the default Nginx page
sudo rm /etc/nginx/sites-enabled/default

# Test for syntax errors
sudo nginx -t

# Restart Nginx to apply changes
sudo systemctl restart nginx
```

---

## Step 6: Secure with Free SSL (HTTPS)
Use Certbot to automatically fetch an SSL certificate from Let's Encrypt and update your Nginx configuration.

```bash
sudo certbot --nginx -d srv1881496.hstgr.cloud
```
*When prompted, agree to the terms and choose to redirect HTTP traffic to HTTPS.*

---

## Step 7: Final Verification
1. Open your browser and navigate to `https://srv1881496.hstgr.cloud`. You should see the React interface load securely.
2. Try uploading a short video clip.
3. Check that the queue position appears, processing completes without timeouts, and the download link works successfully.
4. If you ever need to view the backend logs, run:
   ```bash
   cd /srv1881496.hstgr.cloud/video-processor-backend
   sudo docker-compose logs -f api
   ```

You are now successfully deployed to production! 🎉
