# Pin Node >=22.19.0 so Cloud Agent install/typecheck match Pi peer engines
# (@earendil-works/pi-* and nested undici declare engines.node >=22.19.0).
# Debian bookworm keeps computer-use support. Do not COPY the project;
# Cursor checks out the workspace after the image is built.
FROM node:22.19.0-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        sudo \
    && rm -rf /var/lib/apt/lists/* \
    && (id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu) \
    && usermod -aG sudo ubuntu \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu
