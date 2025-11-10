FROM ubuntu:latest
RUN apt-get update
RUN apt-get install nginx -y
COPY dist/. /var/www/html/
COPY default.conf /etc/nginx/sites-enabled/default
EXPOSE 9005
CMD ["nginx", "-g", "daemon off;"]