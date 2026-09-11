# JellyYuStream 🎬📺

> **JellyYuStream** je lahek, samogostujoč (self-hosted) spletni upravitelj, večopravilni sinhronizacijski pogon (multi-job sync engine) in pretočni most (streaming bridge), ki brezhibno poveže medijski katalog platforme **YuStream (yustream.org)** z **Jellyfin** (ali Emby/Plex).

Ustvarja Jellyfin/TMDB skladne `.strm` pretočne datoteke, prenaša uradne **plakate (posters)**, **ozadja (fanart/backdrops)**, generira Kodi/Jellyfin združljive **`.nfo` metapodatke** ter posreduje video tokove preko pretočnega mostu s polno podporo za HTTP Byte Range zahteve (previjanje naprej/nazaj v predvajalniku).

---

## ✨ Glavne zmogljivosti

- **🌐 Sodoben temni spletni vmesnik (Dashboard)**: Upravljanje opravil sinhronizacije (Jobs), predogled zadetkov iz kataloga, testiranje avtentikacije, spremljanje dnevnikov v živo in pregled zgodovine izvajanj.
- **🍿 Jellyfin samodejno osveževanje knjižnice (Auto-Refresh)**: Po vsaki sinhronizaciji novih filmov ali epizod samodejno sproži osvežitev knjižnice preko Jellyfin API-ja (`/Library/Refresh`).
- **📄 Nativni `.nfo` metapodatki**: Generira `movie.nfo` in `tvshow.nfo` z opisi, letnico, žanri, ocenami in igralci.
- **📁 Grafični raziskovalec datotek (File Explorer)**: Vgrajen pregledovalnik map in datotek z možnostjo predogleda posterjev ter neposrednega urejanja `.nfo` in `.strm` datotek.
- **📋 Večopravilni sinhronizacijski urnik (Multi-Job Scheduler)**:
  - Ustvarite poljubno število neodvisnih opravil (npr. *Filmi vsakih 24h*, *Serije vsakih 8h*, filtri po žanrih).
  - Nastavljivi intervali (`Vsako 1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `24h` ali `Ročno`).
- **🖼️ Plakati in ozadja**: Samodejni prenos slik visoke ločljivosti (`poster.jpg`, `fanart.jpg`).
- **🔍 Filtriranje in sortiranje kataloga**:
  - Filtriranje po **letu izida**, **najnižji oceni** in **YuStream žanrih** (Akcija, Drama, Komedija, Kriminal, Triler, Romanca, Fantazija, Grozljivka itd.).
- **📺 Popolna podpora za serije in sezone**: Samodejno prepoznavanje sezon (`Season 01`, `Season 02`...) ter posameznih epizod (`S01E01`, `S01E02`...).
- **⚡ Nativni HTTP pretočni most (Streaming Bridge)**: Naslovljen na `/play/:mediaId`, podpira preusmeritve in HTTP 206 Partial Content za tekoče predvajanje in previjanje.
- **🐳 Docker pripravljen**: Preprost zagon preko Dockerja in Docker Compose.

---

## 📁 Struktura map in medijev

JellyYuStream ustvarja standardno Jellyfin strukturo:

```text
/DATA/Media/
├── MoviesYuStream/
│   └── Mačji Krik (2024)/
│       ├── Mačji Krik (2024).strm     <-- Povezava do lokalnega Bridgea (/play/49063)
│       ├── movie.nfo                   <-- Jellyfin metapodatki
│       ├── poster.jpg                  <-- Uradni plakat
│       └── fanart.jpg                  <-- Ozadje
└── ShowsYuStream/
    └── Škripac (2026)/
        ├── tvshow.nfo
        ├── poster.jpg
        └── Season 01/
            ├── Škripac - S01E01.strm
            ├── Škripac - S01E02.strm
            └── ...
```

---

## 🚀 Zagon in uporaba

### Lokalni zagon (Node.js)
```bash
npm install
npm start
# Odprite http://localhost:3849 v brskalniku
```

### Ročni zagon sinhronizacije preko terminala
```bash
# Testni zagon brez zapisovanja (Dry-run za 10 elementov)
npm run sync:dry -- --limit 10

# Dejanski zagon
npm run sync
```

### Docker Compose
```yaml
services:
  jellyyustream:
    container_name: jellyyustream
    image: jellyyustream:latest
    build: .
    restart: unless-stopped
    ports:
      - "3849:3849"
    environment:
      - PORT=3849
      - CONFIG_PATH=/config/config.json
      - MOVIES_DIR=/media/MoviesYuStream
      - SHOWS_DIR=/media/ShowsYuStream
      - BRIDGE_URL=http://jellyyustream:3849
      - YUSTREAM_USERNAME=your_username
      - YUSTREAM_PASSWORD=your_password
    volumes:
      - /DATA/AppData/jellyyustream/config:/config
      - /DATA/Media:/media
    networks:
      - deanNetwork
```
