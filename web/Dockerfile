FROM nginx:1.27-alpine

# Replace the default site with our config (static files + /api proxy)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The dashboard
COPY index.html style.css app.js /usr/share/nginx/html/

EXPOSE 80
