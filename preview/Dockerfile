# Preview image for @groeponline/pi-missions.
# Builds, packs the npm artifact and smoke-tests the exact files pi loads
# plus the pi-missions CLI, inside a clean container.
#
#   docker build -f preview/Dockerfile -t ghcr.io/groeponline/pi-missions-preview:local .
#   docker run --rm ghcr.io/groeponline/pi-missions-preview:local
FROM node:22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build
RUN mkdir -p /out && npm pack --pack-destination /out

FROM node:22-slim AS preview
WORKDIR /preview
COPY --from=build /out/*.tgz ./pkg.tgz
COPY preview/smoke.sh ./smoke.sh
RUN npm install ./pkg.tgz --prefix ./pkg --no-audit --no-fund && sh ./smoke.sh ./pkg
CMD ["sh", "./smoke.sh", "./pkg"]
