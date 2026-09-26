(function () {
  var Twui = window.Twui = window.Twui || {};

  Twui.esc = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  };

  function unitBase(base) {
    if (Array.isArray(base) && base.length) return base;
    var step = typeof base === "number" && base > 1 ? base : 1000;
    var out = [1];
    for (var i = 0; i < 4; i++) out.push(out[i] * step);
    return out;
  }

  Twui.formatUnit = function (bytes, base, names) {
    var n = Number(bytes);
    if (!Number.isFinite(n)) n = 0;
    var negative = n < 0;
    n = Math.abs(n);
    var steps = unitBase(base);
    var labels = names && names.length ? names : ["B", "kB", "MB", "GB", "TB"];
    var i = 0;
    while (i < steps.length - 1 && n >= steps[i + 1]) i++;
    var value = n / steps[i];
    var digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
    var text = value.toFixed(digits) + " " + labels[Math.min(i, labels.length - 1)];
    return negative ? "−" + text : text;
  };

  Twui.formatBytes = function (bytes, units) {
    var u = units || {};
    return Twui.formatUnit(bytes, u.size_bytes, u.size_units || ["B", "kB", "MB", "GB", "TB"]);
  };

  Twui.formatSpeed = function (bytes, units) {
    var u = units || {};
    return Twui.formatUnit(bytes, u.speed_bytes, u.speed_units || ["B/s", "kB/s", "MB/s", "GB/s", "TB/s"]);
  };

  Twui.formatMemory = function (bytes, units) {
    var u = units || {};
    return Twui.formatUnit(bytes, u.memory_bytes, u.memory_units || ["B", "KiB", "MiB", "GiB", "TiB"]);
  };

  Twui.formatPercent = function (fraction) {
    var n = Number(fraction);
    if (!Number.isFinite(n)) n = 0;
    return Math.round(n * 100) + "%";
  };

  Twui.formatRatio = function (value) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = 0;
    return n.toFixed(2);
  };

  Twui.formatDuration = function (seconds) {
    var n = Number(seconds);
    if (!Number.isFinite(n) || n < 0) return "∞";
    n = Math.round(n);
    if (n < 60) return n + " sec";
    var hours = Math.floor(n / 3600);
    var minutes = Math.floor((n % 3600) / 60);
    if (hours > 0 && minutes > 0) return hours + " hr " + minutes + " min";
    if (hours > 0) return hours + " hr";
    return minutes + " min";
  };

  Twui.formatWhen = function (unix) {
    var n = Number(unix);
    if (!Number.isFinite(n) || n <= 0) return "—";
    return new Date(n * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  };

  Twui.formatCount = function (value) {
    return new Intl.NumberFormat("en-GB").format(Number(value) || 0);
  };

  Twui.basicAuth = function (username, password) {
    var bytes = new TextEncoder().encode(String(username) + ":" + String(password));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "Basic " + btoa(bin);
  };
})();
