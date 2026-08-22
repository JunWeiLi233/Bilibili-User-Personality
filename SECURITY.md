# Security Policy

## Supported Versions

This project is a research prototype. Security updates are provided for the
latest commit on the default branch only.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| others  | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately via GitHub Security Advisories:

1. Go to the [Security Advisories](https://github.com/JunWeiLi233/Bilibili_User_Personality/security/advisories/new) page
2. Click "Report a vulnerability"
3. Fill in the description and details

You can also email the maintainer directly if you prefer.

### What to Expect

- **Acknowledgment**: You will receive an acknowledgment within 48 hours.
- **Updates**: We will keep you informed of progress as we investigate and
  resolve the issue.
- **Credit**: We will credit you in the advisory (unless you prefer to remain
  anonymous).

## Scope

Security issues that are in scope include:

- Unauthorized access to API keys or credentials stored in the codebase
- Injection vulnerabilities (API, scraper inputs, etc.)
- Data exposure from the scraping pipeline
- Dependency vulnerabilities that affect runtime behavior

Out of scope:

- Rate limiting bypasses (the crawler is intentionally conservative)
- CSRF on localhost-only APIs
- Issues that require physical access to the machine running the server

## Secure Configuration

This project stores API keys in environment variables (see `set-deepseek-env.example.ps1`).
Never commit real credentials to the repository. See `CLAUDE.md` for the full
security configuration guide.
