# Copilot Instructions for trigger.dev-ruby

## Project Summary

`trigger.dev-ruby` is a Ruby extension for [trigger.dev](https://trigger.dev), a background jobs and workflow orchestration platform. The extension allows trigger.dev tasks to execute Ruby code, analogous to the official `pythonExtension` in the trigger.dev ecosystem. It is structured as a Ruby gem and is in early development.

## Repository Layout

```
.github/                  # GitHub configuration and Copilot instructions
README.md                 # Project overview
```

As the project grows, expect the following standard Ruby gem structure:

```
lib/                      # Main gem source code
  trigger_dev/            # Core library module
    version.rb            # Gem version constant
spec/ or test/            # RSpec or Minitest test suite
trigger_dev.gemspec       # Gem specification (dependencies, metadata)
Gemfile                   # Development dependencies
Rakefile                  # Build/test automation tasks
.rubocop.yml              # RuboCop linting configuration
```

## Build & Test Commands

> The project is in early development. Once a gemspec and test suite are added, use:

```bash
# Install dependencies
bundle install

# Run tests (RSpec)
bundle exec rspec

# Run tests (Minitest)
bundle exec rake test

# Run linter
bundle exec rubocop

# Auto-fix linting issues
bundle exec rubocop -a

# Build the gem
gem build *.gemspec

# Install the gem locally
gem install *.gem
```

Always run `bundle install` before running tests or the linter.

## Coding Standards

- Use **Ruby 3.1+** unless an earlier version is specified in `.ruby-version` or the gemspec.
- Follow **RuboCop** defaults (or rules in `.rubocop.yml` if present). Run `bundle exec rubocop` before committing.
- Use **RSpec** as the testing framework, with `spec/` as the test directory.
- Prefer `require_relative` for internal requires within the gem.
- Keep public API methods documented with [YARD](https://yardoc.org/) doc comments.
- Follow standard gem naming conventions: module name `TriggerDev`, gem name `trigger_dev`.
- Do not commit `Gemfile.lock` to the repository for gems (only for applications).

## Key Conventions

- The gem entry point is `lib/trigger_dev.rb`.
- The gem version is defined in `lib/trigger_dev/version.rb` as `TriggerDev::VERSION`.
- HTTP communication with the trigger.dev API should use `net/http` (stdlib) or `faraday` as a dependency.
- Sensitive data (API keys, secrets) must never be hard-coded; always read from environment variables.
- Raise descriptive errors by subclassing `TriggerDev::Error` (a custom base error class).

## Workflow

- Use feature branches off `main`.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (e.g., `feat:`, `fix:`, `chore:`).
- Run `bundle exec rubocop` and the full test suite before opening a pull request.
- Pull requests require passing CI checks before merging.
