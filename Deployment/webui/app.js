(function () {
  var LIBRARY_FIELDS = ["id", "name", "status", "percent_done", "rate_download", "rate_upload", "eta", "total_size", "upload_ratio", "error_string"];
  var UNLOCK_FIELDS = ["rpc_version_semver", "version", "units", "download_dir", "start_added_torrents"];
  var DETAIL_FIELDS = ["id", "name", "status", "error", "error_string", "percent_done", "percent_complete", "recheck_progress", "rate_download", "rate_upload", "eta", "upload_ratio", "total_size", "size_when_done", "have_valid", "have_unchecked", "downloaded_ever", "uploaded_ever", "left_until_done", "download_dir", "hash_string", "is_private", "comment", "labels", "queue_position", "peers_connected", "magnet_link", "bandwidth_priority", "honors_session_limits", "download_limit", "download_limited", "upload_limit", "upload_limited", "seed_ratio_mode", "seed_ratio_limit", "seed_idle_mode", "seed_idle_limit", "peer_limit", "group", "sequential_download", "files", "file_stats", "wanted", "priorities", "peers", "peers_from", "trackers", "tracker_stats", "tracker_list", "pieces", "piece_count", "piece_size"];
  var SESSION_FIELDS = ["speed_limit_down", "speed_limit_down_enabled", "speed_limit_up", "speed_limit_up_enabled", "alt_speed_down", "alt_speed_up", "alt_speed_enabled", "alt_speed_time_enabled", "alt_speed_time_begin", "alt_speed_time_end", "alt_speed_time_day", "download_dir", "incomplete_dir", "incomplete_dir_enabled", "start_added_torrents", "rename_partial_files", "trash_original_torrent_files", "script_torrent_done_filename", "script_torrent_done_enabled", "script_torrent_added_filename", "script_torrent_added_enabled", "script_torrent_done_seeding_filename", "script_torrent_done_seeding_enabled", "seed_ratio_limited", "seed_ratio_limit", "idle_seeding_limit_enabled", "idle_seeding_limit", "peer_port", "peer_port_random_on_start", "port_forwarding_enabled", "encryption", "peer_limit_global", "peer_limit_per_torrent", "dht_enabled", "pex_enabled", "lpd_enabled", "preferred_transports", "download_queue_enabled", "download_queue_size", "seed_queue_enabled", "seed_queue_size", "queue_stalled_enabled", "queue_stalled_minutes", "blocklist_enabled", "blocklist_url", "blocklist_size", "version", "rpc_version_semver", "units"];
  var STATUS = ["Stopped", "Queued to verify", "Verifying", "Queued to download", "Downloading", "Queued to seed", "Seeding"];
  var FILTERS = [["all", "All"], ["downloading", "Downloading"], ["seeding", "Seeding"], ["stopped", "Stopped"], ["checking", "Checking"], ["error", "Error"], ["active", "Active"], ["finished", "Finished"]];
  var ACTIONS = {
    start: "torrent_start",
    "start-now": "torrent_start_now",
    stop: "torrent_stop",
    verify: "torrent_verify",
    reannounce: "torrent_reannounce",
    "queue-top": "queue_move_top",
    "queue-up": "queue_move_up",
    "queue-down": "queue_move_down",
    "queue-bottom": "queue_move_bottom"
  };
  var WATCH = { start: true, "start-now": true, stop: true, verify: true };
  var PRESETS = ["#14756F", "#1F4E79", "#5C4B8A", "#8C3A3A", "#3D6B4F"];
  var DAYS = [["Monday", 2], ["Tuesday", 4], ["Wednesday", 8], ["Thursday", 16], ["Friday", 32], ["Saturday", 64], ["Sunday", 1]];
  var pollTimer = null;
  var press = null;
  var suppressClick = false;
  var sort = { key: "name", dir: 1 };
  try { sort = JSON.parse(localStorage.getItem("twui.sort")) || sort; } catch (e) { sort = { key: "name", dir: 1 }; }

  var state = {
    mode: "probing",
    view: "torrents",
    torrents: [],
    labels: new Map(),
    selected: new Set(),
    anchor: null,
    detailOpen: false,
    detail: null,
    tab: "overview",
    selectMode: false,
    filter: localStorage.getItem("twui.filter") || "all",
    query: "",
    sort: sort,
    loaded: false,
    stats: null,
    units: null,
    session: null,
    downloadDir: "",
    startAdded: true,
    daemonVersion: "",
    reconnecting: false,
    actionError: "",
    lockError: "",
    pendingAction: null,
    pendingWatch: null,
    pendingKeys: {},
    groups: null,
    groupsTried: false,
    sequentialSupported: true,
    freeSpace: "",
    portResult: "",
    blocklistNote: "",
    prefError: "",
    menuIds: null,
    settingsSection: "appearance",
    addFile: null,
    colour: Twui.colour,
    title: Twui.title,
    appearance: Twui.appearance
  };

  function esc(value) { return Twui.esc(value); }
  function atLeast(value, min) {
    function parts(text) { return String(text || "0").split(".").map(function (n) { return parseInt(n, 10) || 0; }); }
    var a = parts(value);
    var b = parts(min);
    for (var i = 0; i < 3; i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return true;
  }
  function byId(id) {
    for (var i = 0; i < state.torrents.length; i++) if (state.torrents[i].id === id) return state.torrents[i];
    return null;
  }
  function matchesFilter(torrent, filter) {
    var f = filter || state.filter;
    if (f.indexOf("label:") === 0) return (state.labels.get(torrent.id) || []).indexOf(f.slice(6)) !== -1;
    if (f === "downloading") return torrent.status === 3 || torrent.status === 4;
    if (f === "seeding") return torrent.status === 5 || torrent.status === 6;
    if (f === "stopped") return torrent.status === 0;
    if (f === "checking") return torrent.status === 1 || torrent.status === 2;
    if (f === "error") return !!torrent.error_string;
    if (f === "active") return torrent.rate_download > 0 || torrent.rate_upload > 0;
    if (f === "finished") return torrent.percent_done === 1;
    return true;
  }
  function visibleTorrents() {
    var query = state.query.trim().toLowerCase();
    var list = state.torrents.filter(function (torrent) {
      if (!matchesFilter(torrent)) return false;
      if (!query) return true;
      return String(torrent.name || "").toLowerCase().indexOf(query) !== -1;
    });
    var key = state.sort.key;
    var dir = state.sort.dir === -1 ? -1 : 1;
    list.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (key === "name") {
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
      } else if (key === "eta") {
        av = av < 0 ? Infinity : av;
        bv = bv < 0 ? Infinity : bv;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return String(a.name || "").localeCompare(String(b.name || ""), "en-GB");
    });
    return list;
  }
  function countFilter(filter) {
    return state.torrents.filter(function (torrent) { return matchesFilter(torrent, filter); }).length;
  }
  function labelNames() {
    var names = {};
    state.labels.forEach(function (list) {
      (list || []).forEach(function (name) { names[name] = (names[name] || 0) + 1; });
    });
    return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, "en-GB"); }).map(function (name) {
      return [name, names[name]];
    });
  }
  function selectedIds() {
    return Array.from(state.selected);
  }
  function onlyId() {
    var ids = selectedIds();
    return ids.length === 1 ? ids[0] : null;
  }
  function showInspector() {
    if (state.view !== "torrents") return false;
    if (Twui.wide.matches) return state.selected.size >= 1;
    return state.detailOpen && state.selected.size === 1;
  }
  function labelsOnScreen() {
    return Twui.wide.matches || state.view === "torrents";
  }
  function detailWanted() {
    return state.view === "torrents" && state.selected.size === 1 && (Twui.wide.matches || state.detailOpen);
  }
  function barClass(torrent) {
    if (torrent.error_string) return "bar error";
    if (torrent.status === 0) return "bar stopped";
    return "bar";
  }
  function subText(torrent) {
    return torrent.error_string || STATUS[torrent.status] || "Stopped";
  }
  function minutesToTime(value) {
    var minutes = Number(value) || 0;
    var hour = Math.floor(minutes / 60);
    var min = minutes % 60;
    return String(hour).padStart(2, "0") + ":" + String(min).padStart(2, "0");
  }
  function timeToMinutes(value) {
    var bits = String(value || "0:0").split(":");
    return (parseInt(bits[0], 10) || 0) * 60 + (parseInt(bits[1], 10) || 0);
  }
  function pieceBits(detail) {
    var count = detail && detail.piece_count;
    if (!count || !detail.pieces) return null;
    var bin;
    try { bin = atob(detail.pieces); } catch (e) { return null; }
    var have = 0;
    for (var i = 0; i < count; i++) {
      if (bin.charCodeAt(i >> 3) & (128 >> (i & 7))) have++;
    }
    return { bin: bin, count: count, have: have };
  }
  function shownFraction(torrent) {
    var reported = Number(torrent && torrent.percent_done);
    if (!Number.isFinite(reported) || reported < 0) reported = 0;
    if (reported > 1) reported = 1;
    return reported;
  }
  function haveBytes(detail) {
    var valid = Number(detail && detail.have_valid);
    var unchecked = Number(detail && detail.have_unchecked);
    if (!Number.isFinite(valid) || valid < 0) valid = 0;
    if (!Number.isFinite(unchecked) || unchecked < 0) unchecked = 0;
    return { valid: valid, unchecked: unchecked, total: valid + unchecked };
  }
  function progressWidth(fraction) {
    return Math.max(0, Math.min(100, Number(fraction) * 100)).toFixed(2) + "%";
  }
  function pieceLabel(detail) {
    var bits = pieceBits(detail);
    if (!bits) return "";
    return Twui.formatCount(bits.have) + " of " + Twui.formatCount(bits.count) + " pieces";
  }
  function drawPieces(canvas, detail) {
    var bits = pieceBits(detail);
    if (!canvas || !bits) return;
    var width = canvas.parentElement ? canvas.parentElement.clientWidth : 0;
    if (width < 40) width = 320;
    var cell = bits.count > 8000 ? 2 : bits.count > 2000 ? 3 : 6;
    var cols = Math.max(1, Math.floor(width / cell));
    var rows = Math.ceil(bits.count / cols);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cols * cell * dpr);
    canvas.height = Math.floor(rows * cell * dpr);
    canvas.style.height = (rows * cell) + "px";
    var ctx = canvas.getContext("2d");
    var styles = getComputedStyle(document.documentElement);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = styles.getPropertyValue("--track").trim() || "#d7e6e3";
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = styles.getPropertyValue("--accent").trim() || "#14756f";
    var gap = cell > 2 ? 1 : 0;
    for (var i = 0; i < bits.count; i++) {
      if ((bits.bin.charCodeAt(i >> 3) & (128 >> (i & 7))) === 0) continue;
      ctx.fillRect((i % cols) * cell, Math.floor(i / cols) * cell, cell - gap, cell - gap);
    }
  }
  function mountPieces(root, detail) {
    if (!root) return;
    var canvas = root.querySelector("canvas.pieces");
    if (canvas) drawPieces(canvas, detail);
  }
  function refreshInspectorLive(inspector, detail) {
    if (!inspector || !detail) return;
    var fraction = shownFraction(detail);
    inspector.querySelectorAll("[data-live-progress] > span").forEach(function (fill) {
      fill.style.width = progressWidth(fraction);
    });
    inspector.querySelectorAll("[data-live-percent]").forEach(function (node) {
      node.textContent = Twui.formatPercent(fraction);
    });
    inspector.querySelectorAll("[data-live-pieces]").forEach(function (node) {
      node.textContent = pieceLabel(detail);
    });
    mountPieces(inspector, detail);
    var files = detail.files || [];
    var stats = detail.file_stats || [];
    inspector.querySelectorAll("[data-file-done]").forEach(function (node) {
      var index = Number(node.dataset.fileDone);
      var info = stats[index] || {};
      var file = files[index] || {};
      var done = info.bytes_completed != null ? info.bytes_completed : file.bytes_completed;
      node.textContent = Twui.formatBytes(done, state.units) + " of " + Twui.formatBytes(file.length, state.units);
    });
  }

  function failAuthOff() {
    state.mode = "authOff";
    paintRoot();
  }
  function failOld() {
    stopPoll();
    state.mode = "tooOld";
    paintRoot();
  }
  function failUnreachable() {
    state.mode = "unreachable";
    paintRoot();
  }
  function showLock(message) {
    stopPoll();
    state.mode = "locked";
    state.lockError = message || "";
    paintRoot();
  }
  function lock() {
    Twui.clearAuthorization();
    state.torrents = [];
    state.labels = new Map();
    state.selected = new Set();
    state.detail = null;
    state.loaded = false;
    state.stats = null;
    showLock();
  }
  function openFromSession(result) {
    if (!result || result.result === "success" || !atLeast(result.rpc_version_semver, "6.0.0")) return failOld();
    state.units = result.units || null;
    state.downloadDir = result.download_dir || "";
    state.startAdded = !!result.start_added_torrents;
    state.daemonVersion = result.version || "";
    state.mode = "live";
    state.loaded = false;
    state.lockError = "";
    paintRoot();
    startPoll();
    refreshIcons();
  }
  function probe() {
    state.mode = "probing";
    paintRoot();
    Twui.rpc("session_get", { fields: UNLOCK_FIELDS }, { credentials: "omit" }).then(function () {
      failAuthOff();
    }, function (error) {
      if (error.info && error.info.legacy) return failOld();
      if (error.info && error.info.locked) return probeBrowser();
      failUnreachable();
    });
  }
  function probeBrowser() {
    Twui.rpc("session_get", { fields: UNLOCK_FIELDS }).then(openFromSession, function (error) {
      if (error.info && error.info.legacy) return failOld();
      if (error.info && error.info.locked) return showLock();
      failUnreachable();
    });
  }
  function submitLock(username, password) {
    state.lockError = "";
    localStorage.setItem("twui.username", username);
    Twui.setAuthorization(Twui.basicAuth(username, password));
    Twui.rpc("session_get", { fields: UNLOCK_FIELDS }).then(openFromSession, function (error) {
      Twui.clearAuthorization();
      if (error.info && error.info.legacy) return failOld();
      if (error.info && error.info.locked) return showLock("Transmission did not accept the password.");
      failUnreachable();
    });
  }

  function mergeTorrents(list) {
    (list || []).forEach(function (torrent) {
      var found = false;
      for (var i = 0; i < state.torrents.length; i++) {
        if (state.torrents[i].id === torrent.id) {
          state.torrents[i] = torrent;
          found = true;
          break;
        }
      }
      if (!found) state.torrents.push(torrent);
    });
  }
  function watchPending() {
    if (!state.pendingWatch) return;
    var watch = state.pendingWatch;
    var changed = watch.ids.some(function (id) {
      var torrent = byId(id);
      return torrent && torrent.status !== watch.before.get(id);
    });
    if (changed || Date.now() > watch.until) {
      state.pendingWatch = null;
      state.pendingAction = null;
    }
  }
  function tick() {
    if (state.mode !== "live" || document.hidden || state.inFlight) return;
    state.inFlight = true;
    Twui.rpc("torrent_get", { fields: LIBRARY_FIELDS }).then(function (list) {
      state.torrents = list.torrents || [];
      state.torrents.forEach(applyLibraryTorrent);
      var alive = new Set(state.torrents.map(function (torrent) { return torrent.id; }));
      Array.from(state.selected).forEach(function (id) { if (!alive.has(id)) state.selected.delete(id); });
      state.loaded = true;
      paintList();
      return Twui.rpc("session_stats", {});
    }).then(function (stats) {
      state.stats = stats;
      state.reconnecting = false;
      if (!labelsOnScreen()) return null;
      return Twui.rpc("torrent_get", { fields: ["id", "labels"] });
    }).then(function (labelled) {
      if (labelled) {
        state.labels = new Map();
        (labelled.torrents || []).forEach(function (torrent) { state.labels.set(torrent.id, torrent.labels || []); });
      }
      if (!detailWanted()) return null;
      return fetchDetail(onlyId());
    }).then(function (detail) {
      if (detail && detail.torrents && detail.torrents[0]) state.detail = detail.torrents[0];
      watchPending();
      paintLive();
    }, function (error) {
      if (error.info && error.info.locked) return lock();
      if (error.info && error.info.legacy) return failOld();
      state.reconnecting = true;
      paintBanner();
    }).then(function () { state.inFlight = false; });
  }
  function fetchDetail(id) {
    return Twui.rpc("torrent_get", { ids: [id], fields: DETAIL_FIELDS }).then(null, function (error) {
      if (!(error.info && error.info.rpc) || !state.sequentialSupported) throw error;
      state.sequentialSupported = false;
      var fields = DETAIL_FIELDS.filter(function (field) { return field !== "sequential_download"; });
      return Twui.rpc("torrent_get", { ids: [id], fields: fields });
    });
  }
  function startPoll() {
    stopPoll();
    tick();
    pollTimer = setInterval(tick, 2000);
  }
  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    state.inFlight = false;
  }

  function runAction(name, ids) {
    if (!ids.length || state.pendingAction === name) return;
    var before = new Map(ids.map(function (id) {
      var torrent = byId(id);
      return [id, torrent ? torrent.status : null];
    }));
    state.pendingAction = name;
    paintActionState();
    Twui.rpc(ACTIONS[name], { ids: ids }).then(function () {
      return Twui.rpc("torrent_get", { ids: ids, fields: LIBRARY_FIELDS });
    }).then(function (result) {
      mergeTorrents(result.torrents || []);
      var changed = (result.torrents || []).some(function (torrent) { return before.get(torrent.id) !== torrent.status; });
      if (!changed && WATCH[name]) state.pendingWatch = { ids: ids, before: before, until: Date.now() + 6000 };
      else state.pendingAction = null;
      state.actionError = "";
      paintLive();
    }, function (error) {
      state.pendingAction = null;
      if (error.info && error.info.locked) return lock();
      state.actionError = error.message;
      paintLive();
    });
  }
  function currentIds() {
    if (state.menuIds && state.menuIds.length) return state.menuIds.slice();
    return selectedIds();
  }

  function markSvg() {
    return '<span class="mark" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v7M4.8 7.8 8 11.2 11.2 7.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }
  function filterButtons(className) {
    var html = className === "filter-btn" ? '<div class="group-label">Filters</div>' : "";
    html += FILTERS.map(function (filter) {
      var active = state.view === "torrents" && state.filter === filter[0] ? " active" : "";
      return '<button type="button" class="' + className + active + '" data-act="filter" data-filter="' + filter[0] + '"><span>' + filter[1] + '</span><span class="count" data-count="' + filter[0] + '">0</span></button>';
    }).join("");
    var labels = labelNames();
    if (labels.length) {
      html += '<div class="group-label">Labels</div>';
      html += labels.map(function (label) {
        var key = "label:" + label[0];
        var active = state.view === "torrents" && state.filter === key ? " active" : "";
        return '<button type="button" class="' + className + active + '" data-act="filter" data-filter="' + esc(key) + '"><span class="clip">' + esc(label[0]) + '</span><span class="count">' + Twui.formatCount(label[1]) + '</span></button>';
      }).join("");
    }
    return html;
  }
  function shellHtml() {
    return '<div id="shell" class="shell"><aside class="sidebar"><div class="brand">' + markSvg() + '<div class="brand-copy"><div class="brand-name clip" data-brand data-full="' + esc(state.title) + '">' + esc(state.title) + '</div><div class="host clip" data-full="' + esc(location.host) + '">' + esc(location.host) + '</div></div></div><nav class="nav" aria-label="Sections"><button type="button" class="nav-btn" data-act="view" data-view="torrents">Torrents</button><button type="button" class="nav-btn" data-act="view" data-view="activity">Activity</button><button type="button" class="nav-btn" data-act="view" data-view="settings">Settings</button></nav><div class="filters" aria-label="Filters">' + filterButtons("filter-btn") + '</div><div class="speeds"><div><span>Down</span><strong class="slot" data-speed="down"></strong></div><div><span>Up</span><strong class="slot" data-speed="up"></strong></div></div></aside><div class="workspace"><header class="phone-head"><div class="brand">' + markSvg() + '<div class="brand-copy"><div class="brand-name clip" data-brand data-full="' + esc(state.title) + '">' + esc(state.title) + '</div><div class="host clip" data-full="' + esc(location.host) + '">' + esc(location.host) + '</div></div></div><div class="speeds"><div><span>Down</span><strong data-speed="down"></strong></div><div><span>Up</span><strong data-speed="up"></strong></div></div></header><div class="chips" aria-label="Library">' + filterButtons("chip") + '</div><div class="toolbar"><input id="search" class="search" type="search" placeholder="Filter by name" aria-label="Filter by name" value="' + esc(state.query) + '"><div class="toolbar-actions"><button type="button" class="ghost" data-act="select-mode">Select</button><button type="button" class="ghost" data-act="start">Start</button><button type="button" class="ghost" data-act="stop">Stop</button><button type="button" class="ghost" data-act="verify">Verify</button><button type="button" class="ghost" data-act="remove">Remove</button><button type="button" class="ghost" data-act="more">More</button><button type="button" class="ghost" data-act="lock">Lock</button><button type="button" class="primary" data-act="add">Add</button></div></div><div id="banner" class="banner" hidden></div><div id="list-scroll" class="scroller"></div></div><aside id="inspector" class="inspector" aria-label="Torrent"></aside><nav class="tabbar" aria-label="Sections"><button type="button" class="bar-btn" data-act="view" data-view="torrents">Torrents</button><button type="button" class="bar-btn" data-act="view" data-view="activity">Activity</button><button type="button" class="bar-btn" data-act="view" data-view="settings">Settings</button></nav></div><div id="dialog-root"></div><div id="menu" class="menu" role="menu" hidden></div><div id="tip" class="tip" role="tooltip" hidden></div>';
  }
  function applyLibraryTorrent(torrent) {
    if (!state.detail || state.detail.id !== torrent.id) return;
    LIBRARY_FIELDS.forEach(function (key) {
      if (key !== "id") state.detail[key] = torrent[key];
    });
  }
  function rowHtml(torrent) {
    var selected = state.selected.has(torrent.id);
    var fraction = shownFraction(torrent);
    var check = '<span class="check-col"><input type="checkbox" data-check="' + torrent.id + '"' + (selected ? " checked" : "") + ' aria-label="Select ' + esc(torrent.name) + '"></span>';
    return '<div class="row' + (selected ? " selected" : "") + '" data-id="' + torrent.id + '" role="row" aria-selected="' + selected + '">' + check + '<div class="card-body"><div class="name clip" data-full="' + esc(torrent.name) + '">' + esc(torrent.name) + '</div><div class="sub clip' + (torrent.error_string ? " error" : "") + '" data-full="' + esc(subText(torrent)) + '">' + esc(subText(torrent)) + '</div><div class="card-meta"><span>Size <b>' + esc(Twui.formatBytes(torrent.total_size, state.units)) + '</b></span><span>Down <b>' + esc(Twui.formatSpeed(torrent.rate_download, state.units)) + '</b></span><span>Up <b>' + esc(Twui.formatSpeed(torrent.rate_upload, state.units)) + '</b></span><span>ETA <b>' + esc(Twui.formatDuration(torrent.eta)) + '</b></span><span>Ratio <b>' + esc(Twui.formatRatio(torrent.upload_ratio)) + '</b></span></div></div><div class="progress-cell"><span class="' + barClass(torrent) + '" data-live-progress><span style="width:' + progressWidth(fraction) + '"></span></span><span class="pct" data-live-percent>' + esc(Twui.formatPercent(fraction)) + '</span></div><div class="num">' + esc(Twui.formatBytes(torrent.total_size, state.units)) + '</div><div class="num">' + esc(Twui.formatSpeed(torrent.rate_download, state.units)) + '</div><div class="num">' + esc(Twui.formatSpeed(torrent.rate_upload, state.units)) + '</div><div class="num">' + esc(Twui.formatDuration(torrent.eta)) + '</div><div class="num">' + esc(Twui.formatRatio(torrent.upload_ratio)) + '</div></div>';
  }
  function listHtml() {
    if (!state.loaded) {
      var bones = "";
      for (var i = 0; i < 8; i++) bones += '<div class="row skeleton-row"><div><div class="skeleton name"></div><div class="skeleton sub"></div></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
      return '<div class="head-row"><span>Name</span><span>Progress</span><span class="num">Size</span><span class="num">Down</span><span class="num">Up</span><span class="num">ETA</span><span class="num">Ratio</span></div>' + bones;
    }
    var rows = visibleTorrents();
    if (!rows.length) {
      var empty = !state.torrents.length && state.filter === "all" && !state.query.trim();
      return '<div class="note"><p>' + (empty ? "No torrents yet" : "Nothing in this filter") + '</p><button type="button" class="primary" data-act="' + (empty ? "add" : "filter") + '"' + (empty ? "" : ' data-filter="all"') + '>' + (empty ? "Add" : "Show all") + '</button></div>';
    }
    var head = '<div class="head-row" role="row"><button type="button" class="left" data-act="sort" data-sort="name">Name</button><button type="button" data-act="sort" data-sort="percent_done">Progress</button><button type="button" class="num" data-act="sort" data-sort="total_size">Size</button><button type="button" class="num" data-act="sort" data-sort="rate_download">Down</button><button type="button" class="num" data-act="sort" data-sort="rate_upload">Up</button><button type="button" class="num" data-act="sort" data-sort="eta">ETA</button><button type="button" class="num" data-act="sort" data-sort="upload_ratio">Ratio</button></div>';
    return head + rows.map(rowHtml).join("");
  }

  function stat(label, value) {
    return '<div><span class="muted">' + label + '</span><strong class="clip" data-full="' + esc(value) + '">' + esc(value) + '</strong></div>';
  }
  function inspectorHtml(detail) {
    var name = detail.name || "";
    var tabs = ["overview", "files", "peers", "trackers"].map(function (tab) {
      return '<button type="button" class="tab' + (state.tab === tab ? " active" : "") + '" data-act="tab" data-tab="' + tab + '">' + tab.charAt(0).toUpperCase() + tab.slice(1) + '</button>';
    }).join("");
    return '<div class="inspector-head"><button type="button" class="ghost" data-act="back">Back</button><h2 class="clip" data-full="' + esc(name) + '">' + esc(name) + '</h2><button type="button" class="icon-btn inspector-close" data-act="close-inspector" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div><div class="inspector-actions"><button type="button" class="ghost" data-act="start">Start</button><button type="button" class="ghost" data-act="stop">Stop</button><button type="button" class="ghost" data-act="verify">Verify</button><button type="button" class="ghost" data-act="remove">Remove</button><button type="button" class="ghost" data-act="more">More</button></div><div class="tabs" role="tablist">' + tabs + '</div><div class="inspector-body">' + inspectorBody(detail) + '</div>';
  }
  function inspectorBody(detail) {
    if (state.tab === "files") return filesHtml(detail);
    if (state.tab === "peers") return peersHtml(detail);
    if (state.tab === "trackers") return trackersHtml(detail);
    var labels = (detail.labels || []).join(", ");
    var controls = '<label class="field">Bandwidth priority<select data-torrent="bandwidth_priority">' + [["-1", "Low"], ["0", "Normal"], ["1", "High"]].map(function (item) {
      return '<option value="' + item[0] + '"' + (String(detail.bandwidth_priority) === item[0] ? " selected" : "") + '>' + item[1] + '</option>';
    }).join("") + '</select></label>';
    controls += checkTorrent("honors_session_limits", "Honour session speed limits", detail.honors_session_limits);
    controls += '<label class="field check"><input type="checkbox" data-torrent="download_limited"' + (detail.download_limited ? " checked" : "") + (state.pendingKeys.download_limited ? " disabled" : "") + '> Limit download</label>';
    controls += '<label class="field">Download limit (kB/s)<input data-torrent="download_limit" type="number" min="0" step="1" value="' + esc(detail.download_limit || 0) + '"' + (state.pendingKeys.download_limit ? " disabled" : "") + '></label>';
    controls += '<label class="field check"><input type="checkbox" data-torrent="upload_limited"' + (detail.upload_limited ? " checked" : "") + (state.pendingKeys.upload_limited ? " disabled" : "") + '> Limit upload</label>';
    controls += '<label class="field">Upload limit (kB/s)<input data-torrent="upload_limit" type="number" min="0" step="1" value="' + esc(detail.upload_limit || 0) + '"' + (state.pendingKeys.upload_limit ? " disabled" : "") + '></label>';
    controls += '<label class="field">Seed ratio<select data-torrent="seed_ratio_mode">' + [["0", "Follow the session"], ["1", "Stop at this ratio"], ["2", "Unlimited"]].map(function (item) {
      return '<option value="' + item[0] + '"' + (String(detail.seed_ratio_mode) === item[0] ? " selected" : "") + '>' + item[1] + '</option>';
    }).join("") + '</select></label>';
    controls += '<label class="field">Torrent seed ratio<input data-torrent="seed_ratio_limit" type="number" min="0" step="0.1" value="' + esc(detail.seed_ratio_limit || 0) + '"></label>';
    controls += '<label class="field">Idle seeding<select data-torrent="seed_idle_mode">' + [["0", "Follow the session"], ["1", "Stop when idle"], ["2", "Unlimited"]].map(function (item) {
      return '<option value="' + item[0] + '"' + (String(detail.seed_idle_mode) === item[0] ? " selected" : "") + '>' + item[1] + '</option>';
    }).join("") + '</select></label>';
    controls += '<label class="field">Idle limit (minutes)<input data-torrent="seed_idle_limit" type="number" min="0" step="1" value="' + esc(detail.seed_idle_limit || 0) + '"></label>';
    controls += '<label class="field">Labels<input data-torrent="labels" type="text" value="' + esc(labels) + '"></label>';
    controls += '<label class="field">Peer limit<input data-torrent="peer_limit" type="number" min="0" step="1" value="' + esc(detail.peer_limit || 0) + '"></label>';
    if (state.groups && state.groups.length) {
      controls += '<label class="field">Bandwidth group<select data-torrent="group"><option value="">None</option>' + state.groups.map(function (group) {
        return '<option' + (detail.group === group.name ? " selected" : "") + '>' + esc(group.name) + '</option>';
      }).join("") + '</select></label>';
    }
    if (state.sequentialSupported && "sequential_download" in detail) controls += checkTorrent("sequential_download", "Download in order", detail.sequential_download);
    controls += '<button type="button" class="ghost" data-act="rename-torrent">Rename</button>';
    var fraction = shownFraction(detail);
    var held = haveBytes(detail);
    var haveLabel = Twui.formatBytes(held.total, state.units);
    if (held.unchecked > 0) haveLabel += " (" + Twui.formatBytes(held.unchecked, state.units) + " not yet checked)";
    var progress = '<div class="inspector-progress"><span class="bar" data-live-progress><span style="width:' + progressWidth(fraction) + '"></span></span><span class="pct" data-live-percent>' + esc(Twui.formatPercent(fraction)) + '</span></div>';
    var pieces = detail.piece_count ? '<canvas class="pieces" aria-label="' + esc(pieceLabel(detail)) + '"></canvas><p class="note" data-live-pieces>' + esc(pieceLabel(detail)) + '</p>' : "";
    return progress + '<div class="stats">' + stat("Down", Twui.formatSpeed(detail.rate_download, state.units)) + stat("Up", Twui.formatSpeed(detail.rate_upload, state.units)) + stat("ETA", Twui.formatDuration(detail.eta)) + stat("Ratio", Twui.formatRatio(detail.upload_ratio)) + stat("Size", Twui.formatBytes(detail.size_when_done, state.units)) + stat("Have", haveLabel) + stat("Remaining", Twui.formatBytes(detail.left_until_done, state.units)) + stat("Downloaded", Twui.formatBytes(detail.downloaded_ever, state.units)) + stat("Uploaded", Twui.formatBytes(detail.uploaded_ever, state.units)) + stat("Location", detail.download_dir || "") + stat("Hash", detail.hash_string || "") + stat("Privacy", detail.is_private ? "Private" : "Public") + stat("Peers", Twui.formatCount(detail.peers_connected)) + stat("Queue", Twui.formatCount(detail.queue_position)) + "</div>" + (detail.status === 1 || detail.status === 2 ? '<p>Verifying ' + esc(Twui.formatPercent(detail.recheck_progress)) + '</p>' : "") + pieces + controls + (detail.comment ? '<p class="clip" data-full="' + esc(detail.comment) + '">' + esc(detail.comment) + '</p>' : "");
  }
  function checkTorrent(key, label, checked) {
    return '<label class="field check"><input type="checkbox" data-torrent="' + key + '"' + (checked ? " checked" : "") + (state.pendingKeys[key] ? " disabled" : "") + "> " + label + "</label>";
  }
  function filesHtml(detail) {
    var files = detail.files || [];
    var stats = detail.file_stats || [];
    if (!files.length) return '<p class="note">This torrent has no files.</p>';
    return files.map(function (file, index) {
      var info = stats[index] || {};
      var wanted = "wanted" in info ? info.wanted : (detail.wanted || [])[index];
      var priority = "priority" in info ? info.priority : (detail.priorities || [])[index];
      var done = info.bytes_completed != null ? info.bytes_completed : file.bytes_completed;
      var disabled = state.pendingKeys["file-" + index] ? " disabled" : "";
      return '<div class="file"><div class="clip" data-full="' + esc(file.name) + '">' + esc(file.name) + '</div><div class="muted" data-file-done="' + index + '">' + esc(Twui.formatBytes(done, state.units)) + " of " + esc(Twui.formatBytes(file.length, state.units)) + '</div><label class="check"><input type="checkbox" data-file="' + index + '"' + (wanted ? " checked" : "") + disabled + '> Download</label><label class="field">Priority<select data-priority="' + index + '"><option value="-1"' + (priority === -1 ? " selected" : "") + '>Low</option><option value="0"' + (priority === 0 ? " selected" : "") + '>Normal</option><option value="1"' + (priority === 1 ? " selected" : "") + '>High</option></select></label><button type="button" class="ghost" data-act="rename-file" data-path="' + esc(file.name) + '">Rename</button></div>';
    }).join("");
  }
  function peersHtml(detail) {
    var from = detail.peers_from || {};
    var breakdown = [["Tracker", from.from_tracker], ["Incoming", from.from_incoming], ["Cache", from.from_cache], ["DHT", from.from_dht], ["PEX", from.from_pex], ["LPD", from.from_lpd], ["LTEP", from.from_ltep]].map(function (item) {
      return item[0] + " " + Twui.formatCount(item[1] || 0);
    }).join(" · ");
    var peers = detail.peers || [];
    var note = "<p class='note'>" + esc(breakdown) + "</p>";
    if (!peers.length) return "<p>No peers are connected.</p>" + note;
    var head = [["Address", ""], ["Client", ""], ["Progress", " num"], ["Down", " num"], ["Up", " num"]].map(function (column) {
      return '<span class="peer-head' + column[1] + '">' + column[0] + "</span>";
    }).join("");
    var rows = peers.map(function (peer) {
      var address = peer.address || "";
      var full = address + (peer.is_encrypted ? " · encrypted" : "");
      return '<span class="clip" data-full="' + esc(full) + '">' + esc(address) + '</span><span class="clip" data-full="' + esc(peer.client_name || "") + '">' + esc(peer.client_name || "") + '</span><span class="num">' + esc(Twui.formatPercent(peer.progress)) + '</span><span class="num">' + esc(Twui.formatSpeed(peer.rate_to_client, state.units)) + '</span><span class="num">' + esc(Twui.formatSpeed(peer.rate_to_peer, state.units)) + "</span>";
    }).join("");
    return note + '<div class="peer-grid">' + head + rows + "</div>";
  }
  function trackersHtml(detail) {
    var list = detail.tracker_stats || [];
    var rows = list.map(function (tracker) {
      var text = tracker.announce || "";
      var result = tracker.last_announce_result || "No announce yet";
      return '<div class="tracker"><div class="clip" data-full="' + esc(text) + '">' + esc(text) + '</div><div class="muted clip" data-full="' + esc(result) + '">' + esc(result) + " · " + Twui.formatCount(tracker.seeder_count || 0) + " seeding · " + Twui.formatCount(tracker.leecher_count || 0) + " downloading</div></div>";
    }).join("");
    return rows + '<label class="field">Announce URLs, one per line. A blank line starts a new tier.<textarea id="tracker-list"' + (state.pendingKeys.tracker_list ? " disabled" : "") + '>' + esc(detail.tracker_list || "") + '</textarea></label><button type="button" class="primary" data-act="save-trackers"' + (state.pendingKeys.tracker_list ? " disabled" : "") + ">Save trackers</button>";
  }
  function summaryHtml() {
    var ids = selectedIds();
    var size = 0;
    var down = 0;
    var up = 0;
    ids.forEach(function (id) {
      var torrent = byId(id);
      if (!torrent) return;
      size += torrent.total_size || 0;
      down += torrent.rate_download || 0;
      up += torrent.rate_upload || 0;
    });
    return '<div class="inspector-head"><h2>' + Twui.formatCount(ids.length) + ' torrents</h2><button type="button" class="icon-btn inspector-close" data-act="close-inspector" aria-label="Close"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div><div class="inspector-actions"><button type="button" class="ghost" data-act="start">Start</button><button type="button" class="ghost" data-act="stop">Stop</button><button type="button" class="ghost" data-act="verify">Verify</button><button type="button" class="ghost" data-act="remove">Remove</button><button type="button" class="ghost" data-act="more">More</button></div><div class="inspector-body"><div class="stats">' + stat("Size", Twui.formatBytes(size, state.units)) + stat("Down", Twui.formatSpeed(down, state.units)) + stat("Up", Twui.formatSpeed(up, state.units)) + "</div><p class='note'>Files and peers are shown when one torrent is selected.</p></div>";
  }

  function activityHtml() {
    var stats = state.stats || {};
    var current = stats.current_stats || {};
    var cumulative = stats.cumulative_stats || {};
    function block(title, item) {
      return "<h2>" + title + "</h2><div class='stats'>" + stat("Downloaded", Twui.formatBytes(item.downloaded_bytes, state.units)) + stat("Uploaded", Twui.formatBytes(item.uploaded_bytes, state.units)) + stat("Files added", Twui.formatCount(item.files_added)) + stat("Active time", Twui.formatDuration(item.seconds_active)) + stat("Sessions", Twui.formatCount(item.session_count)) + "</div>";
    }
    return "<h2>Session</h2><div class='stats'>" + stat("Download", Twui.formatSpeed(stats.download_speed, state.units)) + stat("Upload", Twui.formatSpeed(stats.upload_speed, state.units)) + stat("Active", Twui.formatCount(stats.active_torrent_count)) + stat("Stopped", Twui.formatCount(stats.paused_torrent_count)) + stat("Torrents", Twui.formatCount(stats.torrent_count)) + "</div>" + block("This session", current) + block("Cumulative", cumulative);
  }

  var SETTING_SECTIONS = [
    { id: "speed", title: "Speed", fields: [
      { key: "speed_limit_down_enabled", type: "bool", label: "Limit download" },
      { key: "speed_limit_down", type: "int", label: "Download limit (kB/s)" },
      { key: "speed_limit_up_enabled", type: "bool", label: "Limit upload" },
      { key: "speed_limit_up", type: "int", label: "Upload limit (kB/s)" },
      { key: "alt_speed_enabled", type: "bool", label: "Use alternative speeds" },
      { key: "alt_speed_down", type: "int", label: "Alternative download (kB/s)" },
      { key: "alt_speed_up", type: "int", label: "Alternative upload (kB/s)" },
      { key: "alt_speed_time_enabled", type: "bool", label: "Schedule alternative speeds" },
      { key: "alt_speed_time_begin", type: "time", label: "From" },
      { key: "alt_speed_time_end", type: "time", label: "Until" },
      { key: "alt_speed_time_day", type: "days", label: "Days" }
    ]},
    { id: "downloads", title: "Downloads", fields: [
      { key: "download_dir", type: "text", label: "Download directory" },
      { key: "incomplete_dir_enabled", type: "bool", label: "Use an incomplete directory" },
      { key: "incomplete_dir", type: "text", label: "Incomplete directory" },
      { key: "start_added_torrents", type: "bool", label: "Start added torrents" },
      { key: "rename_partial_files", type: "bool", label: "Append .part to incomplete files" },
      { key: "trash_original_torrent_files", type: "bool", label: "Move original torrent files to the rubbish" },
      { key: "script_torrent_added_enabled", type: "bool", label: "Run a script when a torrent is added" },
      { key: "script_torrent_added_filename", type: "text", label: "Added script" },
      { key: "script_torrent_done_enabled", type: "bool", label: "Run a script when a torrent finishes" },
      { key: "script_torrent_done_filename", type: "text", label: "Done script" },
      { key: "script_torrent_done_seeding_enabled", type: "bool", label: "Run a script when seeding finishes" },
      { key: "script_torrent_done_seeding_filename", type: "text", label: "Seeding-done script" }
    ]},
    { id: "seeding", title: "Seeding", fields: [
      { key: "seed_ratio_limited", type: "bool", label: "Stop seeding at a ratio" },
      { key: "seed_ratio_limit", type: "float", label: "Seed ratio" },
      { key: "idle_seeding_limit_enabled", type: "bool", label: "Stop seeding when idle" },
      { key: "idle_seeding_limit", type: "int", label: "Idle limit (minutes)" }
    ]},
    { id: "connections", title: "Connections", fields: [
      { key: "peer_port", type: "int", label: "Peer port" },
      { key: "peer_port_random_on_start", type: "bool", label: "Pick a random port on start" },
      { key: "port_forwarding_enabled", type: "bool", label: "Forward the port" },
      { key: "encryption", type: "select", label: "Encryption", options: [["required", "Required"], ["preferred", "Preferred"], ["allowed", "Allowed"]] },
      { key: "peer_limit_global", type: "int", label: "Peer limit" },
      { key: "peer_limit_per_torrent", type: "int", label: "Peer limit per torrent" },
      { key: "dht_enabled", type: "bool", label: "DHT" },
      { key: "pex_enabled", type: "bool", label: "Peer exchange" },
      { key: "lpd_enabled", type: "bool", label: "Local peer discovery" },
      { key: "preferred_transports", type: "transports", label: "Transports" }
    ]},
    { id: "queue", title: "Queue", fields: [
      { key: "download_queue_enabled", type: "bool", label: "Limit active downloads" },
      { key: "download_queue_size", type: "int", label: "Download queue size" },
      { key: "seed_queue_enabled", type: "bool", label: "Limit active seeds" },
      { key: "seed_queue_size", type: "int", label: "Seed queue size" },
      { key: "queue_stalled_enabled", type: "bool", label: "Idle torrents do not count" },
      { key: "queue_stalled_minutes", type: "int", label: "Idle after (minutes)" }
    ]},
    { id: "blocklist", title: "Blocklist", fields: [
      { key: "blocklist_enabled", type: "bool", label: "Enable the blocklist" },
      { key: "blocklist_url", type: "text", label: "Blocklist URL" }
    ]}
  ];

  function fieldControl(field) {
    var value = state.session[field.key];
    var disabled = state.pendingKeys[field.key] ? " disabled" : "";
    if (field.type === "bool") return '<label class="field check"><input type="checkbox" data-key="' + field.key + '" data-type="bool"' + (value ? " checked" : "") + disabled + "> " + field.label + "</label>";
    if (field.type === "int" || field.type === "float") return '<label class="field">' + field.label + '<input type="number" data-key="' + field.key + '" data-type="' + field.type + '" step="' + (field.type === "float" ? "0.1" : "1") + '" value="' + esc(value == null ? 0 : value) + '"' + disabled + "></label>";
    if (field.type === "text") return '<label class="field">' + field.label + '<input type="text" data-key="' + field.key + '" data-type="text" value="' + esc(value || "") + '"' + disabled + "></label>";
    if (field.type === "time") return '<label class="field">' + field.label + '<input type="time" data-key="' + field.key + '" data-type="time" value="' + minutesToTime(value) + '"' + disabled + "></label>";
    if (field.type === "select") return '<label class="field">' + field.label + '<select data-key="' + field.key + '" data-type="select"' + disabled + ">" + field.options.map(function (option) {
      return '<option value="' + option[0] + '"' + (value === option[0] ? " selected" : "") + ">" + option[1] + "</option>";
    }).join("") + "</select></label>";
    if (field.type === "days") return '<div class="field"><span>' + field.label + '</span>' + DAYS.map(function (day) {
      var on = (Number(value) & day[1]) !== 0;
      return '<label class="check"><input type="checkbox" data-key="alt_speed_time_day" data-type="days" data-day="' + day[1] + '"' + (on ? " checked" : "") + disabled + "> " + day[0] + "</label>";
    }).join("") + "</div>";
    if (field.type === "transports") {
      var list = Array.isArray(value) ? value : [];
      return '<div class="field"><span>' + field.label + '</span><label class="check"><input type="checkbox" data-key="preferred_transports" data-type="transports" data-transport="tcp"' + (list.indexOf("tcp") !== -1 ? " checked" : "") + disabled + "> TCP</label><label class='check'><input type='checkbox' data-key='preferred_transports' data-type='transports' data-transport='utp'" + (list.indexOf("utp") !== -1 ? " checked" : "") + disabled + "> µTP</label></div>";
    }
    return "";
  }
  function appearanceHtml() {
    var pendingColour = state.pendingKeys.colour ? " disabled" : "";
    var pendingTitle = state.pendingKeys.title ? " disabled" : "";
    var modes = ["light", "dark", "system"].map(function (mode) {
      return '<label class="check"><input type="radio" name="appearance" value="' + mode + '"' + (state.appearance === mode ? " checked" : "") + "> " + mode.charAt(0).toUpperCase() + mode.slice(1) + "</label>";
    }).join("");
    return '<p class="note">This colour marks this Transmission instance. Lightness is adjusted so text stays readable. The title is the name in the window. Both are remembered in this browser and applied the next time this address is opened.</p><label class="field">Base colour<input id="colour-field" type="color" value="' + esc(state.colour) + '"' + pendingColour + '></label><div class="swatches">' + PRESETS.map(function (hex) {
      return '<button type="button" class="swatch' + (state.colour.toLowerCase() === hex.toLowerCase() ? " current" : "") + '" data-act="preset" data-colour="' + hex + '" style="background:' + hex + '" aria-label="' + hex + '"' + pendingColour + "></button>";
    }).join("") + '</div><p class="note">' + esc(state.prefError) + '</p><label class="field">Page title<input id="title-field" type="text" value="' + esc(state.title) + '"' + pendingTitle + "></label><div class='field'><span>Appearance on this device</span>" + modes + "</div><p class='version'>Interface " + esc(Twui.VERSION) + (state.daemonVersion ? " · Transmission " + esc(state.daemonVersion) : "") + "</p>";
  }
  function settingsHtml() {
    var sections = [{ id: "appearance", title: "Appearance" }].concat(SETTING_SECTIONS);
    if (state.groups !== false) sections.push({ id: "groups", title: "Groups" });
    var nav = '<div class="settings-nav">' + sections.map(function (section) {
      return '<button type="button" class="chip' + (state.settingsSection === section.id ? " active" : "") + '" data-act="settings" data-section="' + section.id + '">' + section.title + "</button>";
    }).join("") + "</div>";
    var body = "";
    if (state.settingsSection === "appearance") body = appearanceHtml();
    else if (state.settingsSection === "groups") body = groupsHtml();
    else if (!state.session) body = '<p class="note">Reading settings…</p>';
    else {
      var section = SETTING_SECTIONS.filter(function (item) { return item.id === state.settingsSection; })[0];
      body = section.fields.map(fieldControl).join("");
      if (section.id === "downloads") body += '<p class="note" id="free-space">' + esc(state.freeSpace) + "</p>";
      if (section.id === "connections") body += '<div class="toolbar-actions"><button type="button" class="ghost" data-act="port" data-protocol="ipv4">Test IPv4</button><button type="button" class="ghost" data-act="port" data-protocol="ipv6">Test IPv6</button></div><p class="note">' + esc(state.portResult) + "</p>";
      if (section.id === "blocklist") body += '<p class="note">' + Twui.formatCount(state.session.blocklist_size || 0) + ' rules. ' + esc(state.blocklistNote) + '</p><button type="button" class="primary" data-act="blocklist">Update blocklist</button>';
    }
    return nav + body + '<div class="version"><button type="button" class="danger" data-act="shutdown">Shut down Transmission</button></div>';
  }
  function groupsHtml() {
    if (!state.groupsTried) return "<p class='note'>Reading groups…</p>";
    if (state.groups === false) return "<p class='note'>This daemon has no bandwidth groups.</p>";
    if (!state.groups.length) return "<p class='note'>No bandwidth groups yet.</p>";
    return state.groups.map(function (group) {
      return '<div class="file"><strong class="clip" data-full="' + esc(group.name) + '">' + esc(group.name) + '</strong><label class="check"><input type="checkbox" data-group="' + esc(group.name) + '" data-group-key="honors_session_limits"' + (group.honors_session_limits ? " checked" : "") + "> Honour session limits</label><label class='check'><input type='checkbox' data-group='" + esc(group.name) + "' data-group-key='speed_limit_down_enabled'" + (group.speed_limit_down_enabled ? " checked" : "") + "> Limit download</label><label class='field'>Download (kB/s)<input data-group='" + esc(group.name) + "' data-group-key='speed_limit_down' type='number' value='" + esc(group.speed_limit_down || 0) + "'></label><label class='check'><input type='checkbox' data-group='" + esc(group.name) + "' data-group-key='speed_limit_up_enabled'" + (group.speed_limit_up_enabled ? " checked" : "") + "> Limit upload</label><label class='field'>Upload (kB/s)<input data-group='" + esc(group.name) + "' data-group-key='speed_limit_up' type='number' value='" + esc(group.speed_limit_up || 0) + "'></label></div>";
    }).join("");
  }

  function gateHtml() {
    var title = state.title;
    var body = "<p>Opening this instance…</p>";
    if (state.mode === "authOff") body = "<p>Turn on RPC authentication in Transmission, then reload.</p>";
    if (state.mode === "tooOld") body = "<p>This interface needs Transmission 4.1 or newer.</p>";
    if (state.mode === "unreachable") body = '<p>Transmission did not respond.</p><button type="button" class="primary" data-act="retry">Try again</button>';
    if (state.mode === "locked") {
      var username = localStorage.getItem("twui.username") || "";
      body = '<form id="lock-form"><label class="field">Username<input name="username" type="text" autocomplete="username" value="' + esc(username) + '"></label><label class="field">Password<input name="password" type="password" autocomplete="current-password"></label><p class="note">' + esc(state.lockError) + '</p><button type="submit" class="primary">Unlock</button></form>';
    }
    return '<div class="gate"><div class="dialog" role="dialog" aria-modal="true"><div class="brand">' + markSvg() + '<div class="brand-copy"><div class="brand-name">' + esc(title) + '</div><div class="host">' + esc(location.host) + '</div></div></div>' + body + "</div></div>";
  }

  function paintRoot() {
    var app = document.getElementById("app");
    app.setAttribute("aria-busy", state.mode === "probing" || (state.mode === "live" && !state.loaded) ? "true" : "false");
    if (state.mode !== "live") {
      app.innerHTML = gateHtml();
      var password = app.querySelector('input[name="password"]');
      if (password && state.lockError) password.focus();
      return;
    }
    if (!document.getElementById("shell")) app.innerHTML = shellHtml();
    document.title = state.title;
    paintLive();
  }
  function paintLive() {
    if (state.mode !== "live" || !document.getElementById("shell")) return;
    var shell = document.getElementById("shell");
    shell.classList.toggle("library-view", state.view === "torrents");
    shell.classList.toggle("has-inspector", showInspector() && Twui.wide.matches);
    shell.classList.toggle("detail-open", showInspector() && !Twui.wide.matches);
    shell.classList.toggle("selecting", state.selectMode);
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === state.view);
    });
    document.querySelectorAll("[data-brand]").forEach(function (node) {
      node.textContent = state.title;
      node.setAttribute("data-full", state.title);
    });
    var scroll = document.getElementById("list-scroll");
    var top = scroll ? scroll.scrollTop : 0;
    if (state.view === "activity") scroll.innerHTML = activityHtml();
    else if (state.view === "settings") {
      if (state.rebuildSettings || !scroll.querySelector(".settings-nav")) {
        scroll.innerHTML = settingsHtml();
        state.rebuildSettings = false;
      }
    }
    else if (!(showInspector() && !Twui.wide.matches)) {
      scroll.innerHTML = listHtml();
      scroll.scrollTop = top;
      scroll.setAttribute("aria-busy", state.loaded ? "false" : "true");
    }
    var inspector = document.getElementById("inspector");
    if (showInspector() && state.selected.size > 1) inspector.innerHTML = summaryHtml();
    else if (showInspector() && state.detail && state.detail.id === onlyId()) {
      var active = document.activeElement;
      var keep = inspector.contains(active) && active.matches("input, textarea, select");
      if (!keep) {
        var body = inspector.querySelector(".inspector-body");
        var bodyTop = body ? body.scrollTop : 0;
        inspector.innerHTML = inspectorHtml(state.detail);
        mountPieces(inspector, state.detail);
        var next = inspector.querySelector(".inspector-body");
        if (next) next.scrollTop = bodyTop;
      } else refreshInspectorLive(inspector, state.detail);
    } else if (showInspector()) inspector.innerHTML = '<div class="inspector-body"><p class="note">Reading torrent…</p></div>';
    else inspector.innerHTML = "";
    paintFilters();
    paintCounts();
    paintSpeeds();
    paintBanner();
    paintActionState();
    var main = document.querySelector(".workspace");
    if (main) main.setAttribute("aria-busy", state.loaded ? "false" : "true");
  }
  function paintList() {
    if (state.view !== "torrents" || (showInspector() && !Twui.wide.matches)) return;
    var scroll = document.getElementById("list-scroll");
    if (!scroll) return;
    var top = scroll.scrollTop;
    scroll.innerHTML = listHtml();
    scroll.scrollTop = top;
    scroll.setAttribute("aria-busy", state.loaded ? "false" : "true");
  }
  function paintFilters() {
    var filters = document.querySelector(".filters");
    var chips = document.querySelector(".chips");
    if (filters) filters.innerHTML = filterButtons("filter-btn");
    if (chips) chips.innerHTML = filterButtons("chip");
  }
  function paintCounts() {
    document.querySelectorAll("[data-count]").forEach(function (node) {
      node.textContent = Twui.formatCount(countFilter(node.dataset.count));
    });
    document.querySelectorAll("[data-filter]").forEach(function (button) {
      button.classList.toggle("active", state.view === "torrents" && button.dataset.filter === state.filter);
    });
  }
  function paintSpeeds() {
    document.querySelectorAll("[data-speed]").forEach(function (node) {
      if (!state.stats) {
        node.innerHTML = '<span class="skeleton"></span>';
        return;
      }
      var value = node.dataset.speed === "down" ? state.stats.download_speed : state.stats.upload_speed;
      node.textContent = Twui.formatSpeed(value, state.units);
    });
  }
  function paintBanner() {
    var banner = document.getElementById("banner");
    if (!banner) return;
    var text = state.reconnecting ? "Reconnecting…" : (state.actionError || "");
    banner.hidden = !text;
    banner.textContent = text;
  }
  function paintActionState() {
    var hasSelection = state.selected.size > 0 || (state.menuIds && state.menuIds.length);
    document.querySelectorAll("[data-act]").forEach(function (button) {
      var act = button.dataset.act;
      if ((act === "more" || act === "remove") && button.closest(".toolbar, .inspector-actions")) {
        button.disabled = state.pendingAction === act || state.selected.size === 0;
        return;
      }
      if (!ACTIONS[act]) return;
      button.disabled = state.pendingAction === act || (button.closest(".toolbar, .inspector-actions") && state.selected.size === 0);
      if (button.closest(".menu")) button.disabled = state.pendingAction === act || !hasSelection;
    });
  }
  function refreshFreeSpace() {
    var path = state.session && state.session.download_dir;
    if (!path) return;
    Twui.rpc("free_space", { path: path }).then(function (result) {
      state.freeSpace = "Free space " + Twui.formatBytes(result.size_bytes, state.units) + (result.total_size != null ? " of " + Twui.formatBytes(result.total_size, state.units) : "");
      var node = document.getElementById("free-space");
      if (node) node.textContent = state.freeSpace;
    }, function () {});
  }
  function loadSession() {
    Twui.rpc("session_get", { fields: SESSION_FIELDS }).then(function (result) {
      state.session = result;
      state.units = result.units || state.units;
      state.daemonVersion = result.version || state.daemonVersion;
      if (state.groupsTried) return null;
      state.groupsTried = true;
      return Twui.rpc("group_get", {}).then(function (groups) {
        state.groups = groups.group || [];
      }, function () { state.groups = false; });
    }).then(function () {
      refreshFreeSpace();
      state.rebuildSettings = true;
      if (state.view === "settings") paintLive();
    }, function (error) {
      if (error.info && error.info.locked) return lock();
      state.actionError = error.message;
      paintBanner();
    });
  }
  function setSession(patch) {
    var keys = Object.keys(patch);
    if (keys.some(function (key) { return state.pendingKeys[key]; })) return;
    keys.forEach(function (key) { state.pendingKeys[key] = true; });
    state.rebuildSettings = true;
    paintLive();
    Twui.rpc("session_set", patch).then(function () {
      return Twui.rpc("session_get", { fields: keys });
    }).then(function (result) {
      keys.forEach(function (key) { state.session[key] = result[key]; });
      if (patch.download_dir) refreshFreeSpace();
      state.actionError = "";
    }, function (error) {
      if (error.info && error.info.locked) return lock();
      state.actionError = error.message;
    }).then(function () {
      keys.forEach(function (key) { delete state.pendingKeys[key]; });
      state.rebuildSettings = true;
      if (state.mode === "live") paintLive();
    });
  }
  function setTorrent(patch, key) {
    var id = onlyId();
    if (id == null || state.pendingKeys[key]) return;
    state.pendingKeys[key] = true;
    paintLive();
    var params = Object.assign({ ids: [id] }, patch);
    Twui.rpc("torrent_set", params).then(function () {
      return fetchDetail(id);
    }).then(function (result) {
      if (result.torrents && result.torrents[0]) state.detail = result.torrents[0];
      state.actionError = "";
    }, function (error) {
      if (error.info && error.info.locked) return lock();
      state.actionError = error.message;
    }).then(function () {
      delete state.pendingKeys[key];
      if (state.mode === "live") paintLive();
    });
  }
  function saveColour(hex) {
    if (state.pendingKeys.colour) return;
    var pick = Twui.hexToOklch(hex);
    if (!pick || pick.C < 0.02) {
      state.prefError = "Choose a colour with a visible hue.";
      state.rebuildSettings = true;
      paintLive();
      return;
    }
    state.pendingKeys.colour = true;
    state.rebuildSettings = true;
    paintLive();
    if (!Twui.applyTheme(hex, state.appearance)) {
      state.prefError = "Choose a colour with a visible hue.";
    } else {
      try {
        Twui.saveColour(hex);
        state.colour = hex;
        state.prefError = "";
        refreshIcons();
      } catch (error) {
        state.prefError = "The colour could not be stored.";
      }
    }
    delete state.pendingKeys.colour;
    state.rebuildSettings = true;
    paintLive();
  }
  function saveTitle(value) {
    if (state.pendingKeys.title) return;
    state.pendingKeys.title = true;
    state.rebuildSettings = true;
    paintLive();
    try {
      state.title = Twui.saveTitle(value);
      document.title = state.title;
      state.prefError = "";
      refreshIcons();
    } catch (error) {
      state.prefError = "The title could not be stored.";
    }
    delete state.pendingKeys.title;
    state.rebuildSettings = true;
    paintLive();
  }
  function refreshIcons() {
    if (!window.caches || !Twui.accentHex) return;
    function draw(size, maskable) {
      var canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext("2d");
      var radius = size * (maskable ? 0.08 : 0.22);
      ctx.fillStyle = Twui.accentHex;
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, radius);
      ctx.fill();
      ctx.strokeStyle = Twui.onAccent || "#f4fbfa";
      ctx.lineWidth = Math.max(2, size * 0.07);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(size * 0.5, size * 0.28);
      ctx.lineTo(size * 0.5, size * 0.66);
      ctx.moveTo(size * 0.32, size * 0.5);
      ctx.lineTo(size * 0.5, size * 0.7);
      ctx.lineTo(size * 0.68, size * 0.5);
      ctx.stroke();
      return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
    }
    Promise.all([draw(192, false), draw(512, false), draw(512, true)]).then(function (blobs) {
      return caches.open("twui-" + Twui.VERSION).then(function (cache) {
        var names = ["icons/icon-192.png?v" + Twui.VERSION, "icons/icon-512.png?v" + Twui.VERSION, "icons/icon-maskable-512.png?v" + Twui.VERSION];
        return Promise.all(blobs.map(function (blob, index) {
          if (!blob) return null;
          return cache.put(names[index], new Response(blob, { headers: { "Content-Type": "image/png" } }));
        })).then(function () {
          var manifest = {
            name: state.title + " · " + location.host,
            short_name: state.title,
            id: location.origin + "/transmission/web/",
            start_url: "/transmission/web/",
            scope: "/transmission/web/",
            display: "standalone",
            background_color: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f3faf9",
            theme_color: Twui.accentHex,
            icons: [
              { src: names[0], sizes: "192x192", type: "image/png" },
              { src: names[1], sizes: "512x512", type: "image/png" },
              { src: names[2], sizes: "512x512", type: "image/png", purpose: "maskable" }
            ]
          };
          return cache.put("manifest.webmanifest?v" + Twui.VERSION, new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/manifest+json" } }));
        });
      });
    }).catch(function () {});
  }

  function openDialog(html, selector) {
    var root = document.getElementById("dialog-root");
    if (!root) return;
    root.innerHTML = '<div class="scrim"><div class="dialog" role="dialog" aria-modal="true">' + html + "</div></div>";
    state.dialog = true;
    var focus = root.querySelector(selector || "input, button");
    if (focus) focus.focus();
  }
  function closeDialog() {
    var root = document.getElementById("dialog-root");
    if (root) root.innerHTML = "";
    state.dialog = false;
    state.addFile = null;
  }
  function addDialog() {
    state.addFile = null;
    openDialog('<h2>Add torrent</h2><label class="field">Torrent file<input id="add-file" type="file" accept=".torrent,application/x-bittorrent"></label><label class="field">Magnet or URL<input id="add-url" type="text" placeholder="magnet:?xt=urn:btih:…"></label><label class="field">Download directory<input id="add-dir" type="text" value="' + esc(state.downloadDir) + '"></label><p class="note" id="add-space"></p><label class="check"><input id="add-start" type="checkbox"' + (state.startAdded ? " checked" : "") + "> Start immediately</label><label class='field'>Labels<input id='add-labels' type='text'></label><p class='note' id='add-error'></p><div class='dialog-actions'><button type='button' class='ghost' data-act='close'>Cancel</button><button type='button' class='primary' data-act='add-submit'>Add</button></div>", "#add-file");
    querySpace(state.downloadDir, "add-space");
  }
  function querySpace(path, nodeId) {
    if (!path) return;
    Twui.rpc("free_space", { path: path }).then(function (result) {
      var node = document.getElementById(nodeId);
      if (node) node.textContent = "Free space " + Twui.formatBytes(result.size_bytes, state.units);
    }, function () {});
  }
  function submitAdd() {
    var file = state.addFile;
    var url = (document.getElementById("add-url").value || "").trim();
    var dir = document.getElementById("add-dir").value.trim();
    var start = document.getElementById("add-start").checked;
    var labels = document.getElementById("add-labels").value.split(",").map(function (label) { return label.trim(); }).filter(Boolean);
    var error = document.getElementById("add-error");
    if (!file && !url) {
      error.textContent = "Choose a torrent file or paste a magnet or URL.";
      return;
    }
    var button = document.querySelector("[data-act='add-submit']");
    if (button) button.disabled = true;
    var send = function (params) {
      if (dir) params.download_dir = dir;
      params.paused = !start;
      if (labels.length) params.labels = labels;
      Twui.rpc("torrent_add", params).then(function (result) {
        var added = result.torrent_added || result.torrent_duplicate;
        closeDialog();
        if (result.torrent_duplicate) state.actionError = "This torrent is already present.";
        if (added && added.id != null) {
          state.selected = new Set([added.id]);
          state.detailOpen = !Twui.wide.matches;
          state.anchor = added.id;
        }
        tick();
      }, function (err) {
        if (err.info && err.info.locked) return lock();
        if (error) error.textContent = err.message;
        if (button) button.disabled = false;
      });
    };
    if (file) {
      file.arrayBuffer().then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var bin = "";
        for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        send({ metainfo: btoa(bin) });
      });
    } else send({ filename: url });
  }
  function removeDialog(ids) {
    openDialog("<h2>Remove " + Twui.formatCount(ids.length) + (ids.length === 1 ? " torrent" : " torrents") + '?</h2><p>The downloaded files stay on disk.</p><div class="dialog-actions"><button type="button" class="ghost" data-act="close">Cancel</button><button type="button" class="danger" data-act="remove-files" data-ids="' + ids.join(",") + '">Remove and delete files</button><button type="button" class="primary" data-act="remove-keep" data-ids="' + ids.join(",") + '">Remove</button></div>', "[data-act='remove-keep']");
  }
  function removeFilesDialog(ids) {
    openDialog("<h2>Delete the downloaded files?</h2><p>This removes " + Twui.formatCount(ids.length) + (ids.length === 1 ? " torrent" : " torrents") + ' and the files on disk.</p><div class="dialog-actions"><button type="button" class="primary" data-act="close">Cancel</button><button type="button" class="danger" data-act="remove-confirm" data-ids="' + ids.join(",") + '">Delete files</button></div>', "[data-act='close']");
  }
  function doRemove(ids, deleteFiles) {
    closeDialog();
    state.pendingAction = "remove";
    paintActionState();
    Twui.rpc("torrent_remove", { ids: ids, delete_local_data: deleteFiles }).then(function () {
      state.pendingAction = null;
      state.selected = new Set();
      state.detail = null;
      state.detailOpen = false;
      state.actionError = "";
      tick();
    }, function (error) {
      state.pendingAction = null;
      if (error.info && error.info.locked) return lock();
      state.actionError = error.message;
      paintLive();
    });
  }
  function locationDialog(ids) {
    openDialog('<h2>Set location</h2><label class="field">Directory<input id="location-path" type="text" value="' + esc(state.downloadDir) + '"></label><label class="check"><input id="location-move" type="checkbox" checked> Move the files</label><div class="dialog-actions"><button type="button" class="ghost" data-act="close">Cancel</button><button type="button" class="primary" data-act="location-save" data-ids="' + ids.join(",") + '">Save</button></div>', "#location-path");
  }
  function renameDialog(id, path) {
    var current = path.split("/").pop();
    openDialog('<h2>Rename</h2><label class="field">Name<input id="rename-name" type="text" value="' + esc(current) + '"></label><div class="dialog-actions"><button type="button" class="ghost" data-act="close">Cancel</button><button type="button" class="primary" data-act="rename-save" data-id="' + id + '" data-path="' + esc(path) + '">Rename</button></div>', "#rename-name");
  }
  function menuHtml() {
    var single = state.menuIds && state.menuIds.length === 1;
    var items = [["start", "Start"], ["stop", "Stop"], ["start-now", "Start now"], ["verify", "Verify"], ["reannounce", "Reannounce"], ["rename-torrent", "Rename"], ["location", "Set location"], ["queue-top", "Move to top"], ["queue-up", "Move up"], ["queue-down", "Move down"], ["queue-bottom", "Move to bottom"], ["remove", "Remove"]];
    return items.map(function (item) {
      var disabled = state.pendingAction === item[0] || (item[0] === "rename-torrent" && !single) ? " disabled" : "";
      return '<button type="button" role="menuitem" data-act="' + item[0] + '"' + disabled + ">" + item[1] + "</button>";
    }).join("");
  }
  function openMenu(x, y, ids) {
    state.menuOpenedAt = Date.now();
    state.menuIds = ids;
    var menu = document.getElementById("menu");
    if (!menu) return;
    menu.innerHTML = menuHtml();
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
    var first = menu.querySelector("button");
    if (first) first.focus();
  }
  function closeMenu() {
    var menu = document.getElementById("menu");
    if (menu) menu.hidden = true;
    state.menuIds = null;
  }
  function showTip(text, x, y) {
    var tip = document.getElementById("tip");
    if (!tip) return;
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = "8px";
    tip.style.top = "8px";
    var rect = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(y + 16, window.innerHeight - rect.height - 8)) + "px";
  }
  function hideTip() {
    var tip = document.getElementById("tip");
    if (tip) tip.hidden = true;
  }
  function selectOnly(id) {
    state.selected = new Set([id]);
    state.anchor = id;
  }
  function toggleSelected(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    state.anchor = id;
  }
  function selectRange(id) {
    var rows = visibleTorrents();
    var ids = rows.map(function (torrent) { return torrent.id; });
    var start = ids.indexOf(state.anchor);
    var end = ids.indexOf(id);
    if (start < 0 || end < 0) return selectOnly(id);
    var lo = Math.min(start, end);
    var hi = Math.max(start, end);
    state.selected = new Set(ids.slice(lo, hi + 1));
  }
  function onRowClick(id, event) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!Twui.wide.matches) {
      if (state.selectMode || event.target.matches("[data-check]")) {
        toggleSelected(id);
        paintLive();
        return;
      }
      var scroller = document.getElementById("list-scroll");
      state.listScroll = scroller ? scroller.scrollTop : 0;
      selectOnly(id);
      state.detailOpen = true;
      state.detail = null;
      paintLive();
      fetchDetail(id).then(function (result) {
        if (result.torrents && result.torrents[0]) state.detail = result.torrents[0];
        paintLive();
      }, function (error) {
        if (error.info && error.info.locked) lock();
      });
      return;
    }
    if (event.shiftKey && state.anchor != null) selectRange(id);
    else if (event.metaKey || event.ctrlKey) toggleSelected(id);
    else selectOnly(id);
    state.detailOpen = false;
    if (state.selected.size === 1) {
      state.detail = null;
      fetchDetail(id).then(function (result) {
        if (result.torrents && result.torrents[0]) state.detail = result.torrents[0];
        paintLive();
      }, function () {});
    }
    paintLive();
  }

  function onClick(event) {
    if (state.menuOpenedAt && Date.now() - state.menuOpenedAt < 400 && !event.target.closest("#menu")) return;
    var act = event.target.closest("[data-act]");
    var row = event.target.closest("[data-id]");
    if (event.target.closest("#menu") && !act) return;
    if (!event.target.closest("#menu")) closeMenu();
    if (!event.target.closest("#tip") && !event.target.closest("[data-full]")) hideTip();
    if (event.target.closest("[data-full]") && !Twui.fine.matches) {
      var full = event.target.closest("[data-full]");
      showTip(full.getAttribute("data-full") || full.textContent, event.clientX, event.clientY);
    }
    if (event.target.matches("[data-check]")) {
      var cid = Number(event.target.dataset.check);
      if (event.target.checked) state.selected.add(cid);
      else state.selected.delete(cid);
      state.anchor = cid;
      paintLive();
      return;
    }
    if (row && !act) {
      onRowClick(Number(row.dataset.id), event);
      return;
    }
    if (!act) {
      if (event.target.classList && event.target.classList.contains("scrim")) closeDialog();
      return;
    }
    var name = act.dataset.act;
    if (name === "view") {
      state.view = act.dataset.view;
      state.rebuildSettings = state.view === "settings";
      if (state.view === "settings" && !state.session) loadSession();
      state.detailOpen = false;
      paintLive();
      return;
    }
    if (name === "filter") {
      state.filter = act.dataset.filter;
      state.view = "torrents";
      localStorage.setItem("twui.filter", state.filter);
      paintLive();
      return;
    }
    if (name === "sort") {
      if (state.sort.key === act.dataset.sort) state.sort.dir = state.sort.dir === 1 ? -1 : 1;
      else state.sort = { key: act.dataset.sort, dir: 1 };
      localStorage.setItem("twui.sort", JSON.stringify(state.sort));
      paintLive();
      return;
    }
    if (name === "lock") return lock();
    if (name === "retry") return probe();
    if (name === "add") return addDialog();
    if (name === "close") return closeDialog();
    if (name === "select-mode") {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selected = new Set();
      paintLive();
      return;
    }
    if (name === "more") {
      var rect = act.getBoundingClientRect();
      var ids = selectedIds();
      if (!ids.length && onlyId() != null) ids = [onlyId()];
      openMenu(rect.left, rect.bottom + 4, ids);
      return;
    }
    if (name === "close-inspector") {
      state.selected = new Set();
      state.detail = null;
      state.detailOpen = false;
      paintLive();
      return;
    }
    if (name === "back") {
      state.detailOpen = false;
      paintLive();
      var scroller = document.getElementById("list-scroll");
      if (scroller) scroller.scrollTop = state.listScroll || 0;
      return;
    }
    if (name === "tab") {
      state.tab = act.dataset.tab;
      paintLive();
      return;
    }
    if (ACTIONS[name] || name === "remove" || name === "location") {
      var ids = currentIds();
      closeMenu();
      if (ACTIONS[name]) return runAction(name, ids);
      if (name === "remove") return removeDialog(ids);
      return locationDialog(ids);
    }
    if (name === "remove-keep") return doRemove(act.dataset.ids.split(",").map(Number), false);
    if (name === "remove-files") return removeFilesDialog(act.dataset.ids.split(",").map(Number));
    if (name === "remove-confirm") return doRemove(act.dataset.ids.split(",").map(Number), true);
    if (name === "add-submit") return submitAdd();
    if (name === "location-save") {
      var ids = act.dataset.ids.split(",").map(Number);
      var path = document.getElementById("location-path").value.trim();
      var move = document.getElementById("location-move").checked;
      closeDialog();
      Twui.rpc("torrent_set_location", { ids: ids, location: path, move: move }).then(function () {
        if (ids.length === 1) return fetchDetail(ids[0]);
        return null;
      }).then(function (result) {
        if (result && result.torrents && result.torrents[0]) state.detail = result.torrents[0];
        paintLive();
      }, function (error) {
        if (error.info && error.info.locked) return lock();
        state.actionError = error.message;
        paintBanner();
      });
      return;
    }
    if (name === "rename-torrent") {
      var renameIds = currentIds();
      closeMenu();
      if (renameIds.length !== 1) return;
      var torrent = byId(renameIds[0]) || state.detail;
      if (torrent) renameDialog(renameIds[0], torrent.name || "");
      return;
    }
    if (name === "rename-file") return renameDialog(onlyId(), act.dataset.path || "");
    if (name === "rename-save") {
      var id = Number(act.dataset.id);
      var path = act.dataset.path;
      var next = document.getElementById("rename-name").value.trim();
      closeDialog();
      Twui.rpc("torrent_rename_path", { ids: [id], path: path, name: next }).then(function () {
        return fetchDetail(id);
      }).then(function (result) {
        if (result.torrents && result.torrents[0]) state.detail = result.torrents[0];
        tick();
      }, function (error) {
        if (error.info && error.info.locked) return lock();
        state.actionError = error.message;
        paintBanner();
      });
      return;
    }
    if (name === "save-trackers") {
      var text = document.getElementById("tracker-list").value;
      setTorrent({ tracker_list: text }, "tracker_list");
      return;
    }
    if (name === "preset") return saveColour(act.dataset.colour);
    if (name === "settings") {
      state.settingsSection = act.dataset.section;
      state.rebuildSettings = true;
      if (state.settingsSection !== "appearance" && !state.session) loadSession();
      paintLive();
      return;
    }
    if (name === "port") {
      state.portResult = "Testing…";
      state.rebuildSettings = true;
      paintLive();
      Twui.rpc("port_test", { ip_protocol: act.dataset.protocol }).then(function (result) {
        state.portResult = (act.dataset.protocol === "ipv6" ? "IPv6" : "IPv4") + " port is " + (result.port_is_open ? "open" : "closed") + ".";
        state.rebuildSettings = true;
        paintLive();
      }, function (error) {
        state.portResult = error.message;
        state.rebuildSettings = true;
        paintLive();
      });
      return;
    }
    if (name === "blocklist") {
      state.blocklistNote = "Updating…";
      state.rebuildSettings = true;
      paintLive();
      Twui.rpc("blocklist_update", {}).then(function (result) {
        state.blocklistNote = "Updated to " + Twui.formatCount(result.blocklist_size) + " rules.";
        if (state.session) state.session.blocklist_size = result.blocklist_size;
        state.rebuildSettings = true;
        paintLive();
      }, function (error) {
        if (error.info && error.info.locked) return lock();
        state.blocklistNote = error.message;
        state.rebuildSettings = true;
        paintLive();
      });
      return;
    }
    if (name === "shutdown") {
      openDialog("<h2>Shut down " + esc(location.host) + '?</h2><p>Transmission will stop until it is started again.</p><div class="dialog-actions"><button type="button" class="ghost" data-act="close">Cancel</button><button type="button" class="danger" data-act="shutdown-confirm">Shut down</button></div>', "[data-act='close']");
      return;
    }
    if (name === "shutdown-confirm") {
      closeDialog();
      Twui.rpc("session_close", {}).then(function () {
        stopPoll();
        state.mode = "unreachable";
        state.actionError = "";
        paintRoot();
        var note = document.querySelector(".gate p");
        if (note) note.textContent = "The daemon is shutting down.";
      }, function (error) {
        state.actionError = error.message;
        paintBanner();
      });
    }
  }

  function onChange(event) {
    var el = event.target;
    if (el.id === "add-file") {
      state.addFile = el.files && el.files[0] ? el.files[0] : null;
      return;
    }
    if (el.id === "add-dir") return querySpace(el.value.trim(), "add-space");
    if (el.id === "colour-field") return saveColour(el.value);
    if (el.id === "title-field") return saveTitle(el.value);
    if (el.name === "appearance") {
      state.appearance = el.value;
      Twui.saveAppearance(el.value);
      Twui.applyTheme(state.colour, el.value);
      return;
    }
    if (el.dataset.torrent) {
      var key = el.dataset.torrent;
      var detail = state.detail || {};
      var want;
      if (el.type === "checkbox") {
        want = el.checked;
        el.checked = !!detail[key];
      } else if (key === "labels") {
        want = el.value.split(",").map(function (label) { return label.trim(); }).filter(Boolean);
      } else if (el.type === "number" || key === "bandwidth_priority" || key === "seed_ratio_mode" || key === "seed_idle_mode") {
        want = key === "seed_ratio_limit" ? Number(el.value) : parseInt(el.value, 10);
        if (key !== "seed_ratio_limit") el.value = detail[key];
      } else want = el.value;
      var patch = {};
      patch[key] = want;
      setTorrent(patch, key);
      return;
    }
    if (el.dataset.file != null) {
      var index = Number(el.dataset.file);
      var wanted = el.checked;
      el.checked = !wanted;
      var filePatch = wanted ? { files_wanted: [index] } : { files_unwanted: [index] };
      setTorrent(filePatch, "file-" + index);
      return;
    }
    if (el.dataset.priority != null) {
      var fileIndex = Number(el.dataset.priority);
      var level = Number(el.value);
      var priorityPatch = {};
      priorityPatch[level < 0 ? "priority_low" : level > 0 ? "priority_high" : "priority_normal"] = [fileIndex];
      setTorrent(priorityPatch, "priority-" + fileIndex);
      return;
    }
    if (el.dataset.group) {
      var groupName = el.dataset.group;
      var groupKey = el.dataset.groupKey;
      var group = (state.groups || []).filter(function (item) { return item.name === groupName; })[0];
      if (!group) return;
      var next = Object.assign({}, group);
      next[groupKey] = el.type === "checkbox" ? el.checked : parseInt(el.value, 10);
      Twui.rpc("group_set", next).then(function () {
        return Twui.rpc("group_get", {});
      }).then(function (result) {
        state.groups = result.group || [];
        state.rebuildSettings = true;
        paintLive();
      }, function (error) {
        if (error.info && error.info.locked) return lock();
        state.actionError = error.message;
        paintLive();
      });
      return;
    }
    if (!el.dataset.key || !state.session) return;
    var key = el.dataset.key;
    var type = el.dataset.type;
    var value;
    if (type === "bool") {
      value = el.checked;
      el.checked = !!state.session[key];
    } else if (type === "days") {
      value = 0;
      document.querySelectorAll("[data-day]").forEach(function (box) { if (box.checked) value += Number(box.dataset.day); });
    } else if (type === "transports") {
      value = [];
      document.querySelectorAll("[data-transport]").forEach(function (box) { if (box.checked) value.push(box.dataset.transport); });
    } else if (type === "time") {
      value = timeToMinutes(el.value);
      el.value = minutesToTime(state.session[key]);
    } else if (type === "int") {
      value = parseInt(el.value, 10);
      el.value = state.session[key];
    } else if (type === "float") {
      value = Number(el.value);
      el.value = state.session[key];
    } else if (type === "select") {
      value = el.value;
      el.value = state.session[key];
    } else {
      value = el.value;
    }
    var patch = {};
    patch[key] = value;
    setSession(patch);
  }

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", function (event) {
    if (event.target.id === "search") {
      state.query = event.target.value;
      var scroll = document.getElementById("list-scroll");
      if (scroll && state.view === "torrents") scroll.innerHTML = listHtml();
      paintCounts();
    }
  });
  document.addEventListener("submit", function (event) {
    if (event.target.id === "lock-form") {
      event.preventDefault();
      var data = new FormData(event.target);
      submitLock(String(data.get("username") || ""), String(data.get("password") || ""));
    }
  });
  document.addEventListener("contextmenu", function (event) {
    var row = event.target.closest("[data-id]");
    if (!row) return;
    event.preventDefault();
    var id = Number(row.dataset.id);
    var ids = state.selected.has(id) ? selectedIds() : [id];
    openMenu(event.clientX, event.clientY, ids);
  });
  document.addEventListener("pointerdown", function (event) {
    var row = event.target.closest("[data-id]");
    if (!row || event.pointerType === "mouse") return;
    var startX = event.clientX;
    var startY = event.clientY;
    var id = Number(row.dataset.id);
    press = {
      id: id,
      x: startX,
      y: startY,
      timer: setTimeout(function () {
        suppressClick = true;
        var ids = state.selected.has(id) ? selectedIds() : [id];
        openMenu(startX, startY, ids);
        press = null;
      }, 550)
    };
  });
  document.addEventListener("pointermove", function (event) {
    if (!press) return;
    if (Math.abs(event.clientX - press.x) > 8 || Math.abs(event.clientY - press.y) > 8) {
      clearTimeout(press.timer);
      press = null;
    }
  });
  document.addEventListener("pointerup", function () {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  });
  document.addEventListener("pointerover", function (event) {
    if (!Twui.fine.matches) return;
    var node = event.target.closest("[data-full]");
    if (!node || node.scrollWidth <= node.clientWidth + 1) return;
    var rect = node.getBoundingClientRect();
    showTip(node.getAttribute("data-full") || "", rect.left, rect.bottom);
  });
  document.addEventListener("pointerout", function (event) {
    if (!Twui.fine.matches) return;
    if (event.target.closest && event.target.closest("[data-full]")) hideTip();
  });
  document.addEventListener("keydown", function (event) {
    var typing = event.target.matches("input, textarea, select");
    if (event.key === "Escape") {
      if (state.dialog) {
        closeDialog();
        event.preventDefault();
        return;
      }
      if (state.menuIds) {
        closeMenu();
        event.preventDefault();
        return;
      }
      hideTip();
      if (state.detailOpen && !Twui.wide.matches) {
        state.detailOpen = false;
        paintLive();
        return;
      }
      state.selected = new Set();
      paintLive();
      return;
    }
    if (state.dialog && event.key === "Tab") {
      var box = document.querySelector("#dialog-root .dialog");
      if (!box) return;
      var items = Array.from(box.querySelectorAll("button, input, textarea, select")).filter(function (item) { return !item.disabled; });
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
        event.preventDefault();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
        event.preventDefault();
      }
      return;
    }
    if (typing || state.mode !== "live") return;
    if (event.key === "/") {
      var search = document.getElementById("search");
      if (search) search.focus();
      event.preventDefault();
    } else if (event.key === "a" && !event.metaKey && !event.ctrlKey) {
      addDialog();
      event.preventDefault();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (state.selected.size) removeDialog(selectedIds());
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && state.mode === "live") tick();
  });
  Twui.wide = window.matchMedia("(min-width: 1100px)");
  Twui.fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  Twui.wide.addEventListener("change", function () { if (state.mode === "live") paintLive(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register(location.origin + "/transmission/web/sw.js?v0.0.4").catch(function () {});
  probe();
})();
