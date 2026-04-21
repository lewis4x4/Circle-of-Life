# 23 Reputation And Online Presence

- Spec maturity: `historically treated as STUB in planning tables, but meaningful slices are shipped in repo`
- Repo posture: reputation hub, integrations, imports, and posting actions are present

## What It Covers

The public reputation layer for review account management, review import, reply drafting, and posting workflows for platforms such as Google and Yelp.

## Primary Users

- Owners and org admins
- Marketing or operations staff responsible for public-facing reputation

## Key Workflows

- manage external listing accounts per facility
- import external reviews into internal reply workflows
- draft and post public replies
- export account and reply data for oversight

## Primary Surfaces

- `/admin/reputation`
- `/admin/reputation/integrations`
- `/admin/reputation/accounts/new`
- `/admin/reputation/replies/new`

## Data, Controls, And Automation

- `reputation_accounts`
- `reputation_replies`
- Google OAuth credential storage and sync flows
- Google and Yelp import and post APIs
- scheduled cron endpoint for Google review sync

## Deck Framing

- This module broadens Haven from internal operations into brand and public trust management.
- Show the difference between imported public signals and operator-controlled responses.
