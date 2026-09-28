# Transmission WebUI

A browser interface for a [Transmission](https://transmissionbt.com/) daemon. Transmission serves the page itself. You sign in with the username and password that daemon already uses.

## What it does

- Shows your torrent library, with search, filters, and labels.
- Adds a torrent file, a magnet link, or a web address.
- Opens one torrent for its progress, piece map, files, peers, and trackers.
- Starts, stops, verifies, reannounces, and removes torrents. Stop is how you pause. Removing can leave the files where they are, or delete them after a second confirmation.
- Renames a file from the torrent’s Files tab.
- Selects several torrents and runs one action on all of them.
- Shows how much you have downloaded and uploaded, and edits the daemon’s speed, folders, seeding, connections, queue, blocklist, and bandwidth groups.
- Remembers a colour and a window title for this address, in this browser.
- Installs as an app. Each hostname is its own app.

## Install

Use Transmission 4.1 or newer, with its remote password turned on. If the daemon accepts a connection with no password, the page asks you to turn that on and does not open the library.

The latest published release is [v1.0.16](https://github.com/schleising/transmission-webui/releases/tag/v1.0.16).

```bash
git clone https://github.com/schleising/transmission-webui.git
cd transmission-webui
git checkout v1.0.16
```

Copy everything in `Deployment/webui` into the directory Transmission uses for its web interface. Keep the empty `default.json` in that copy, and leave it empty, so Transmission does not complain about a missing file when it starts.

With the linuxserver image, point the container at that directory:

```yaml
environment:
  - TRANSMISSION_WEB_HOME=/webui
volumes:
  - /path/to/webui:/webui
```

If you edit the daemon’s settings yourself, add each public hostname to `rpc-host-whitelist`. Opening the daemon by localhost or by an IP address already works.

Go to:

```text
http://<hostname>:<port>/transmission/web/
```

The browser asks for the Transmission username and password before the page loads. The library then opens in the colour saved for this address, or in the default teal (`#14756F`) with the title Transmission.

The Transmission password is changed in the daemon’s own configuration.

### On your own domain

Use nginx as a reverse proxy, one site for each daemon, with TLS ended on nginx. Proxy `/transmission/` straight through to the daemon, and forward `Authorization` and `X-Transmission-Session-Id` in both directions.

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

Use your own site name and port. The 16 megabyte limit leaves room for a torrent file. Raise it if a larger file is rejected. Add that public hostname to the daemon’s `rpc-host-whitelist`.

## How to use

Torrents, Activity, and Settings are in the sidebar, or on a bar along the bottom on a phone. Current speeds sit at the bottom of the sidebar, and at the end of the header on a phone. The name under the title is the address you opened.

**Torrents.** The toolbar is a name search and Add. The search box does not offer earlier searches. Along the side, or in a row of chips on a phone, you can show All, Downloading, Active, Seeding, Stopped, Finished, Checking, or Error. Any labels you have set are listed after those. Choosing the filter that is already selected, other than All, returns to All. Finished means the download is complete. Click a column heading to sort.

Each torrent shows its status under the name, and a progress bar in that same colour. Downloading is blue, seeding is green, queued is amber, checking is purple, stopped is grey, and an error is red. Those colours stay the same in every theme. While Transmission is checking the files, the bar follows the check. Size is the whole torrent. Downloaded, beside Size on a wide window, is how much has been fetched so far. A long time remaining is shown in weeks and days, or in days and hours. When Transmission has no estimate, the time remaining is ∞.

Click a torrent to open it. On a wide window it sits beside the list. Click it again, or click empty space in the list, to close it. On a phone it replaces the list, and the browser’s back gesture returns to the list. The X closes it. The tabs are Overview, Files, Peers, and Trackers. Overview includes the piece map: grey has not been downloaded, red is not available, and green has been downloaded.

If the page loses the daemon, it returns to the torrent list and shows Reconnecting in the middle until the daemon answers. A short note, such as a torrent already being in the list, stays for three seconds.

**Actions.** Right-click a torrent, or press and hold it on a phone, for Start, Stop, Verify, Remove, and further actions. The same actions are on the open torrent. When that torrent is part of a selection, the menu applies to every selected torrent. Select on the menu starts a selection, a banner counts how many are selected, and its X clears them.

**Add.** Choose a torrent file, or paste a magnet link or address. The folder starts as the daemon’s download folder. The dialogue shows how much free space that folder has as you edit the path.

**Activity** shows current speeds and the totals for this session and since the daemon was first used. Time spent active is given in days, hours, and minutes.

**Settings** changes the daemon. What you see updates after Transmission has stored the change. Settings also shows the interface version, and the Transmission version once the session has been read.

**Appearance**, at the top of Settings, sets the colour, the window title, and light, dark, or system. The colour and the title stay in this browser for this address, and they are applied as soon as you save them. Another browser, or another phone, keeps its own. A grey is refused, because the page is built from one colour. A row of presets is there to choose from, and the default is `#14756F`.

From the browser you can install the page as an app. Install it once for each hostname you use.
