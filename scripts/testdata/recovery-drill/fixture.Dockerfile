ARG CONTROLLER_IMAGE
FROM ${CONTROLLER_IMAGE}

COPY repo.git /srv/git/repo.git
COPY git-http-backend /www/cgi-bin/git

RUN chmod 0555 /www/cgi-bin/git \
    && git --git-dir=/srv/git/repo.git update-server-info

EXPOSE 8080
HEALTHCHECK NONE
ENTRYPOINT ["busybox", "httpd", "-f", "-p", "8080", "-h", "/www"]
CMD []
