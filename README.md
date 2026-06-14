# Zenime

An IMDb-style anime discovery platform built with vanilla JavaScript, HTML, and CSS — powered by the Jikan API.

## Live Demo

**[zenime-gilt.vercel.app](https://zenime-gilt.vercel.app/)**

---

## About

Zenime is a fully functional anime discovery platform that lets you explore, search, and track anime. Browse currently airing and upcoming shows, filter by genre and rating, and save titles to a personal watchlist.

Built without any frameworks or libraries. Pure HTML, CSS, and JavaScript — every feature written from scratch.

---

## Features

- Search any anime by title with real-time results
- Browse currently airing and upcoming shows
- Filter by genre, status, and rating
- Personal watchlist with localStorage persistence
- Anime details — score, episodes, synopsis, trailer
- Fully responsive across desktop and mobile

---

## Tech Stack

- HTML5
- CSS3
- JavaScript ES6+
- Jikan API — unofficial MyAnimeList REST API
- Vercel — deployment

---

## Getting Started

No installation or dependencies required.

```bash
git clone https://github.com/Shah-zaibAly/Zenime.git
cd Zenime
```

Open `index.html` directly in your browser or use the VS Code Live Server extension.

---

## API Reference

This project uses the [Jikan API](https://jikan.moe/) — a free, open source MyAnimeList REST API. No API key required.

| Endpoint | Usage |
|---|---|
| `/anime?q={query}` | Search anime by title |
| `/anime?status=airing` | Currently airing anime |
| `/anime?status=upcoming` | Upcoming anime |
| `/anime/{id}` | Anime details |

---

## What I Learned

- Consuming REST APIs using Fetch API and async/await
- Handling concurrent API requests with Promise.all
- Dynamic DOM manipulation and rendering at scale
- localStorage for persistent data across sessions
- Debounced search to minimize unnecessary API calls
- Loading, error, and empty state handling

---

## Planned Improvements

- Pagination for search results
- Advanced filter combinations
- Anime recommendations based on watchlist
- Migration to React

---

## Author

**Shahzaib Ali**
- GitHub: [Shah-zaibAly](https://github.com/Shah-zaibAly)
- LinkedIn: [linkedin.com/in/yourprofile]([https://linkedin.com/in/yourprofile](https://www.linkedin.com/in/shahzaib-ali-659002374/)

