# Transmission WebUI

A browser interface for a [Transmission](https://transmissionbt.com/) daemon. It is a static page: it has no server of its own, and the only password is the one that daemon already requires. Transmission 4.1 or newer serves the page from `TRANSMISSION_WEB_HOME` and answers JSON-RPC 2.0 at `/transmission/rpc`.

The interface version is 1.0.1. Settings shows that version, and the daemon version once the session has been read. Copy on screen uses British spelling. RPC names stay as Transmission spells them.

The behaviour of the page is written up in [Design/transmission-webui.md](Design/transmission-webui.md). The pictures in that folder are earlier mockups.

## What you can do

- Browse the torrent library, filter it, and search by name.
- Add a `.torrent` file, a magnet link, or an HTTP URL.
- Open one torrent for its progress, piece map, files, peers, and trackers.
- Start, stop, verify, reannounce, queue, rename, move, and remove torrents. Stop is how a torrent is paused. Removing can leave the files on disk, or delete them after a second confirmation.
- Select several torrents and run one action on all of them.
- Read session totals on Activity, and edit the daemon’s speed, download, seeding, connection, queue, blocklist, and bandwidth-group settings.
- Choose a colour and a window title for this address, in this browser.
- Install the page as an app. Each hostname installs separately.

## Requirements

- Transmission 4.1.0 or newer. On unlock the page reads `rpc_version_semver` and will not open the library below `6.0.0`.
- RPC authentication turned on (`rpc-authentication-required`). If the daemon accepts a session with no password, the page explains that and does not show the library.
- The page and `/transmission/rpc` on the same origin. A page loaded from one daemon never calls another daemon.

## Install

[v1.0.1](https://github.com/schleising/transmission-webui/releases/tag/v1.0.1) is the release to install. Copy `Deployment/webui` from that tag into the daemon’s web home. It repeats the first RPC call with the browser cookies when a sign-in gate redirects the cookieless probe.

```bash
git clone https://github.com/schleising/transmission-webui.git
cd transmission-webui
git checkout v1.0.1
```

Copy the contents of `Deployment/webui` into the directory Transmission is using as `TRANSMISSION_WEB_HOME`. The copy must include the empty `default.json` in that directory. Leave it empty. It stops Transmission reporting a missing `default.json` at startup.

Point the daemon at that directory. With the linuxserver image:

```yaml
environment:
  - TRANSMISSION_WEB_HOME=/webui
volumes:
  - /path/to/webui:/webui
```

On a daemon you configure yourself, set `rpc-host-whitelist` to include each public hostname that will open the page. Localhost and IP addresses are already allowed, which covers opening the daemon’s own port.

Open:

```text
http://<hostname>:<port>/transmission/web/
```

The browser asks for the RPC username and password before the page loads. After that, the library opens in the colour saved for this address in this browser. The default colour is `#14756F` and the default title is Transmission.

The page does not change the RPC password. That is not a session setting it can write.

### Remote access

nginx only reverse-proxies. It does not keep a second copy of the HTML, CSS, or scripts. One server block per instance, TLS terminated on nginx, `proxy_pass` with no path of its own so `/transmission/web/` and `/transmission/rpc` reach the daemon unchanged. Forward `Authorization` and `X-Transmission-Session-Id` both ways, or every RPC call stays on `409` or `401`. The block, and why each header is there, is in [Design/transmission-webui.md](Design/transmission-webui.md) under Hosting.

```nginx
server {
  listen 443 ssl;
  server_name media.example;

  client_max_body_size 16m;

  add_header Content-Security-Policy "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; manifest-src 'self'; img-src 'self' data: blob:; worker-src 'self'; base-uri 'none'; form-action 'none'" always;

  location /transmission/ {
    proxy_pass http://127.0.0.1:9091;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Transmission-Session-Id $http_x_transmission_session_id;
    proxy_pass_header X-Transmission-Session-Id;
    proxy_pass_header X-Transmission-Rpc-Version;
  }
}
```

Use your own `server_name` and upstream port. `client_max_body_size 16m` leaves room for a `.torrent` file sent as base64. Raise it if a larger file is rejected. Add the public hostname to that daemon’s `rpc-host-whitelist`.

## Usage

The sidebar, or the bottom bar on a phone, has Torrents, Activity, and Settings. Session speeds sit under the title. The hostname under the title is the address you opened.

**Torrents.** Filter by name in the toolbar, and use the sidebar or the chips for All, Downloading, Seeding, Stopped, Checking, Error, Active, and Finished. Finished means the torrent’s `percent_done` is at least 1. Column headers sort the list. The percentage beside a bar shows two decimal places and does not read 100% until the torrent is complete. A complete row is green.

Click a torrent to open it. On a wide window the inspector is a column beside the list. On a narrower window it replaces the list. The X closes it and clears the selection. Overview, Files, Peers, and Trackers are the four tabs. Overview includes the piece map: grey is not downloaded, red is not available, and green is downloaded.

**Actions.** The toolbar is only the name filter and Add. Start, Stop, Verify, Remove, and More are on the inspector and on the menu. Right-click a row, or long-press it on a phone. If that row is part of a multi-selection, the menu applies to every selected torrent. Select on that menu starts multi-select. A banner shows how many are selected, and its X leaves the mode. More on the inspector does not offer Select.

**Add.** Choose a `.torrent` file, or paste a magnet link or URL. The download directory starts as the session’s download directory, and the dialogue shows free space for the path you type.

**Activity** shows the speeds and the session and cumulative totals. **Settings** edits the daemon. A control stays disabled while its write is in flight, and it changes only after Transmission accepts the write and a follow-up read returns the stored value.

**Appearance**, at the top of Settings, sets the base colour, the window title, and light, dark, or system. The colour and the title are remembered in this browser for this address. They are applied on this page when you save them, and the next time this browser opens this address. They are not copied to another browser or another phone. A grey has no hue to build from, so it is refused. Presets are `#14756F`, `#1F4E79`, `#5C4B8A`, `#8C3A3A`, and `#3D6B4F`.

The page can be installed. The service worker caches the app shell only. It does not cache `/transmission/rpc`.

## Repository

| Path | What it is |
|---|---|
| `Deployment/webui` | The files to install |
| `Design/transmission-webui.md` | How the interface behaves |
| `Testing/docker-compose.yml` | A local Transmission used while developing |
| `Testing/webui-test` | The tree that compose bind-mounts. It is gitignored. After a change under `Deployment/webui`, copy that directory here |

The test stack publishes port 9091 and sets `TRANSMISSION_WEB_HOME=/webui`. The RPC username and password are `USER` and `PASS` in the compose file. Open `http://127.0.0.1:9091/transmission/web/`.

Static files are served with `?v` plus the interface version. After changing `Deployment/webui`, raise that version in `boot.js`, `sw.js`, `index.html`, `manifest.webmanifest`, and the service-worker registration in `app.js`, then copy the deployment tree into `Testing/webui-test`.
