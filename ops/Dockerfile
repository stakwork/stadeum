# stadeum-ops: the box's upkeep (image updates, backups). No port: it starts
# every connection itself. Node runs the compiled loop; the docker CLI with
# its compose plugin drives the containers, and restic takes the snapshots.
# Each comes from its own pinned image.
FROM node:24.11.1-alpine3.22 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM docker:29.6.2-cli AS docker
FROM restic/restic:0.18.1 AS restic

FROM node:24.11.1-alpine3.22
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
WORKDIR /usr/local/lib/stadeum-ops
COPY package.json ./
COPY --from=build /build/dist ./dist
# The commit it was built from, shown on the Updates page.
ARG STADEUM_VERSION=dev
ENV NODE_ENV=production STADEUM_VERSION=${STADEUM_VERSION}
ENTRYPOINT ["node", "/usr/local/lib/stadeum-ops/dist/main.js"]
CMD ["run"]
