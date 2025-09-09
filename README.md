# Bin Collection Scraper

Automated scraper for North Hertfordshire Council bin collection times. Runs daily at 1 AM UTC and adds reminders to Google Calendar.

## Setup

1. Copy `.env.example` to `.env` and fill in your details
2. Deploy: `./deploy-cli.sh`

## Usage

- **Test locally**: `./run-local.sh`
- **Test production**: `./run-prod.sh`
- **Check status**: `./check-status.sh`

## Requirements

- AWS CLI configured with SSO profile
- Node.js 16+