# JAG App

A web app for managing JAG Life Group scheduling at Aflame Church.

🔗 **[Open App](https://tinyurl.com/JAG-App)**

---

## What it does

- **Schedule** — view and edit the weekly Friday life group roster (Separated LG, Combined, Youth Hour, Special events)
- **Members** — manage the member list with roles, group assignments, birthdays, and drive availability
- **Lyrics** — track physical lyric sheet copy counts per song
- **Share** — generate WhatsApp-ready messages for each event with attendee lists
- **Birthday reminders** — 🎂 alerts on event cards when a member's birthday falls within 7 days

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Google Apps Script (`Code.gs`) |
| Frontend | Single-file SPA — all CSS + JS inline (`Index.html`) |
| Database | Google Sheets |
| Hosting | Google Apps Script Web App |

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Server-side backend — sheet reads/writes, data cache, `doGet()` |
| `Index.html` | Frontend SPA — all views, forms, and styles |
| `icon.png` | 180×180 PNG home screen icon (served via jsDelivr CDN for iOS PWA) |
| `CLAUDE.md` | Developer guide — schema, patterns, hygiene rules |

## Development

The app is deployed as a Google Apps Script Web App. To make changes:

1. Edit `Code.gs` and `Index.html` in this repo
2. Copy the contents into the [Apps Script editor](https://script.google.com)
3. Click **Deploy → Manage deployments → Update** to publish

The Google Sheet (source of truth) is private and managed by the JAG team.

## PWA

The app can be added to the iOS or Android home screen as a PWA. The home screen icon is served from this repo via jsDelivr:

```
https://cdn.jsdelivr.net/gh/chenyu-wang/jag-app@main/icon.png
```
