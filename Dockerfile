# Sample docker file to mimic trigger.dev builds
FROM node:22

# Install RVM dependencies
RUN apt-get update && apt-get install -y \
    curl \
    gnupg2 \
    build-essential \
    libssl-dev \
    libreadline-dev \
    zlib1g-dev \
    autoconf \
    bison \
    libyaml-dev \
    libsqlite3-dev \
    sqlite3 \
    libxml2-dev \
    libxslt1-dev \
    libcurl4-openssl-dev \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Install RVM
RUN curl -sSL https://rvm.io/mpapis.asc | gpg2 --import - && \
    curl -sSL https://rvm.io/pkuczynski.asc | gpg2 --import - && \
    curl -sSL https://get.rvm.io | bash -s stable

# Add RVM to PATH and install Ruby 3.2.6 (latest 3.2.x)
RUN /bin/bash -l -c "source /etc/profile.d/rvm.sh && \
    rvm install 3.2.6 && \
    rvm use 3.2.6 --default && \
    gem install bundler"

RUN echo 'source /etc/profile.d/rvm.sh' >> ~/.bashrc

RUN /bin/bash -l -c "ruby --version"
