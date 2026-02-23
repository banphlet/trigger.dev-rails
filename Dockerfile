# Sample docker file to mimic trigger.dev builds
FROM node:20.20-bullseye-slim@sha256:d6c3903e556d4161f63af4550e76244908b6668e1a7d2983eff4873a0c2b0413

# Install Ruby build dependencies
RUN apt-get update && apt-get install -y \
    procps \
    curl \
    git \
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
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Ruby 3.2.6 from source
ENV RUBY_VERSION=3.2.6
RUN wget https://cache.ruby-lang.org/pub/ruby/3.2/ruby-${RUBY_VERSION}.tar.gz && \
    tar -xzf ruby-${RUBY_VERSION}.tar.gz && \
    cd ruby-${RUBY_VERSION} && \
    ./configure --disable-install-doc && \
    make -j$(nproc) && \
    make install && \
    cd .. && \
    rm -rf ruby-${RUBY_VERSION} ruby-${RUBY_VERSION}.tar.gz

# Install bundler
RUN gem install bundler

# Verify installation
RUN ruby --version && bundle --version

# RUN bundle check || bundle install || bundle update