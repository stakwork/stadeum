# stadeum-ops: the box's upkeep (updates, backups) and a stadeum release.
# No port: it starts every connection itself. Node runs the compiled loop;
# the docker CLI with its compose plugin drives the containers, and restic
# takes the snapshots. Each comes from its own pinned image.
#
# Built from the repository's root (`docker build -f ops/Dockerfile .`;
# what goes in: ops/Dockerfile.dockerignore), because the image is the
# release: it carries the stack files of its commit (stack/ without
# local.yml and dev.yml, which are a box's and a laptop's), with
# .env.example and scripts/init-env.sh for scripts/install.sh. ops writes
# them into the box when the release is applied (ops/src/release.ts).
FROM node:24.11.1-alpine3.22 AS build
WORKDIR /build
COPY ops/package.json ops/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ops/tsconfig.json ops/tsconfig.build.json ./
COPY ops/src ./src
RUN npm run build

FROM docker:29.6.2-cli AS docker
FROM restic/restic:0.18.1 AS restic

FROM node:24.11.1-alpine3.22
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY stack /usr/local/share/stadeum/stack
COPY .env.example /usr/local/share/stadeum/.env.example
COPY scripts/init-env.sh /usr/local/share/stadeum/scripts/init-env.sh
WORKDIR /usr/local/lib/stadeum-ops
COPY ops/package.json ./
COPY --from=build /build/dist ./dist
# The commit it was built from, shown on the Updates page.
ARG STADEUM_VERSION=dev
ENV NODE_ENV=production STADEUM_VERSION=${STADEUM_VERSION}
ENTRYPOINT ["node", "/usr/local/lib/stadeum-ops/dist/main.js"]
CMD ["run"]
