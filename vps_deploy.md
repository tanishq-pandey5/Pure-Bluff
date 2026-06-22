# Ubuntu VPS & PostgreSQL Deployment Guide for PureBluff

This guide explains how to deploy the PureBluff multiplayer card game on an Ubuntu VPS, configure a PostgreSQL database, keep the application running continuously with PM2, and set up Nginx with Let's Encrypt SSL for secure HTTPS/WSS (WebSockets) access.

---

## 1. Push to GitHub

Since we initialized a clean local Git repository, you can push it to your GitHub account:

1. Go to [GitHub](https://github.com) and create a new repository named `PureBluff` (do not initialize it with a README, gitignore, or license).
2. Copy the remote URL of your new repository.
3. In your local terminal, run the following commands in the `/Users/tanishqpandey/Documents/Projects/PureBluff` directory:
   ```bash
   # Add your GitHub repository as the remote origin
   git remote add origin <YOUR_GITHUB_REPO_URL>
   
   # Rename default branch to main (if not already main)
   git branch -M main
   
   # Push your code to GitHub
   git push -u origin main
   ```

---

## 2. Set Up Your Ubuntu VPS

Connect to your VPS via SSH:
```bash
ssh root@<YOUR_VPS_IP>
```

### Update System Packages
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Git, Node.js (v20), and PostgreSQL
```bash
# Install Git and build dependencies
sudo apt install -y git curl build-essential

# Install Node.js v20 LTS from NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
node -v
npm -v

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib
```

---

## 3. Configure the PostgreSQL Database

1. Switch to the `postgres` system user and open the PostgreSQL interactive prompt:
   ```bash
   sudo -i -u postgres
   psql
   ```
2. Create the `purebluff` database and a dedicated user:
   ```sql
   -- Create a database
   CREATE DATABASE purebluff;

   -- Create a database user with a secure password
   CREATE USER pb_user WITH PASSWORD 'pb_secure_password';

   -- Grant permissions on the database
   GRANT ALL PRIVILEGES ON DATABASE purebluff TO pb_user;

   -- Quit the prompt
   \q
   ```
3. Exit the `postgres` system user session to return to root/admin shell:
   ```bash
   exit
   ```

---

## 4. Deploy the Application on VPS

1. Clone your repository into a directory (e.g. `/var/www/purebluff`):
   ```bash
   sudo mkdir -p /var/www/purebluff
   sudo chown -R $USER:$USER /var/www/purebluff
   git clone <YOUR_GITHUB_REPO_URL> /var/www/purebluff
   cd /var/www/purebluff
   ```
2. Install production dependencies (NPM):
   ```bash
   npm install --production
   ```
3. Initialize the database schema:
   ```bash
   # Execute db_init.sql schema script as user pb_user
   PGPASSWORD='pb_secure_password' psql -h localhost -U pb_user -d purebluff -f db_init.sql
   ```
4. Create the production environment file:
   ```bash
   nano .env
   ```
   Paste the following configuration:
   ```ini
   PORT=3000
   DATABASE_URL=postgresql://pb_user:pb_secure_password@localhost:5432/purebluff
   ```
   Save and close the file (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## 5. Keep the Server Running Continuously with PM2

Install **PM2** globally to run your Node server as a background service:
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start your application
pm2 start server.js --name "purebluff"

# Make PM2 restart the app automatically on system reboots
pm2 startup
# (Run the command outputted by the screen, if any, to complete startup configuration)

# Save the PM2 process list
pm2 save
```

Useful PM2 commands:
* `pm2 status`: View running applications.
* `pm2 logs purebluff`: Stream live server logs.
* `pm2 restart purebluff`: Restart the server.

---

## 6. Configure Nginx Reverse Proxy with SSL

To access your website securely using HTTPS and secure WebSockets (WSS), configure Nginx as a reverse proxy.

### Install Nginx
```bash
sudo apt install -y nginx
```

### Create Nginx Configuration
```bash
sudo nano /etc/nginx/sites-available/purebluff
```

Paste the configuration below, replacing `yourdomain.com` with your registered domain name:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        
        # Enable WebSockets proxying
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded-for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Save and close.

### Enable the Configuration and Restart Nginx
```bash
# Enable site configuration
sudo ln -s /etc/nginx/sites-available/purebluff /etc/nginx/sites-enabled/
# Remove default Nginx site configuration
sudo rm /etc/nginx/sites-enabled/default

# Test config syntax
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Secure Nginx with Let's Encrypt SSL
Install Certbot to automatically fetch and configure SSL certificates:
```bash
sudo apt install -y certbot python3-certbot-nginx

# Obtain and install the SSL certificate
sudo certbot --nginx -d yourdomain.com
```
Follow the interactive prompts. Certbot will automatically redirect all HTTP traffic to HTTPS.

---

## 7. Connect and Play!
Go to **`https://yourdomain.com`** in your browser to experience secure, high-performance, database-persisted multiplayer Bluff!
