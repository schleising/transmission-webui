/* Applies the saved colour, title, and appearance before the body is painted. */
(function () {
  var VERSION = "1.0.0";
  var DEFAULT_COLOUR = "#14756F";
  var DEFAULT_TITLE = "Transmission";
  var root = document.documentElement;
  var appearance = localStorage.getItem("twui.appearance");
  if (appearance !== "light" && appearance !== "dark" && appearance !== "system") appearance = "system";
  var colour = localStorage.getItem("twui.baseColor");
  if (!colour || !/^#[0-9a-fA-F]{6}$/.test(colour)) colour = DEFAULT_COLOUR;
  var title = localStorage.getItem("twui.title");
  title = title && title.trim() ? title.trim().slice(0, 80) : DEFAULT_TITLE;

  function lin(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function hexToOklch(hex) {
    var r = lin(parseInt(hex.slice(1, 3), 16) / 255);
    var g = lin(parseInt(hex.slice(3, 5), 16) / 255);
    var b = lin(parseInt(hex.slice(5, 7), 16) / 255);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    var A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    var B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    var C = Math.sqrt(A * A + B * B);
    var H = Math.atan2(B, A) * 180 / Math.PI;
    if (H < 0) H += 360;
    return { L: L, C: C, H: H };
  }

  function oklchToRgb(L, C, H) {
    var hr = H * Math.PI / 180;
    var A = C * Math.cos(hr);
    var B = C * Math.sin(hr);
    var l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    var m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    var s_ = L - 0.0894841775 * A - 1.291485548 * B;
    var l = l_ * l_ * l_;
    var m = m_ * m_ * m_;
    var s = s_ * s_ * s_;
    var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    if (r < -0.001 || g < -0.001 || b < -0.001 || r > 1.001 || g > 1.001 || b > 1.001) return null;
    function srgb(c) {
      c = Math.min(1, Math.max(0, c));
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }
    return [srgb(r), srgb(g), srgb(b)];
  }

  function lum(rgb) {
    function f(c) {
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }

  function contrast(a, b) {
    var hi = Math.max(a, b);
    var lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  function css(L, C, H) {
    return "oklch(" + L.toFixed(4) + " " + C.toFixed(4) + " " + H.toFixed(2) + ")";
  }

  function darkMode(mode) {
    if (mode === "dark") return true;
    if (mode === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function applyTheme(hex, mode) {
    var pick = hexToOklch(hex);
    if (!pick || pick.C < 0.02) return false;
    var dark = darkMode(mode);
    var H = pick.H;
    var cap = function (max) { return Math.min(pick.C, max); };
    var accentC = Math.min(Math.max(pick.C, 0.04), 0.12);
    var best = null;
    var cTry = accentC;
    while (cTry >= 0.02 && !best) {
      for (var step = 0; step <= 60; step++) {
        var L = 0.22 + step * 0.01;
        var rgb = oklchToRgb(L, cTry, H);
        if (!rgb) continue;
        var labelLight = oklchToRgb(0.98, Math.min(cTry, 0.01), H);
        var labelDark = oklchToRgb(0.22, Math.min(cTry, 0.03), H);
        if (!labelLight || !labelDark) continue;
        var cl = contrast(lum(rgb), lum(labelLight));
        var cd = contrast(lum(rgb), lum(labelDark));
        var useLight = cl >= cd;
        var ratio = useLight ? cl : cd;
        if (ratio < 4.5) continue;
        var score = Math.abs(L - pick.L);
        if (!best || score < best.score) best = { L: L, C: cTry, light: useLight, score: score };
      }
      if (!best) cTry -= 0.01;
    }
    if (!best) return false;
    var bg = dark ? 0.21 : 0.97;
    var surface = dark ? 0.26 : 0.995;
    var sunken = dark ? 0.3 : 0.94;
    var textL = dark ? 0.96 : 0.27;
    var mutedL = dark ? 0.78 : 0.45;
    var lineL = dark ? 0.36 : 0.86;
    var trackL = dark ? 0.34 : 0.9;
    var tokens = {
      "--bg": css(bg, cap(dark ? 0.03 : 0.02), H),
      "--surface": css(surface, cap(dark ? 0.025 : 0.012), H),
      "--sunken": css(sunken, cap(dark ? 0.03 : 0.025), H),
      "--text": css(textL, cap(dark ? 0.03 : 0.04), H),
      "--muted": css(mutedL, cap(0.03), H),
      "--line": css(lineL, cap(0.02), H),
      "--track": css(trackL, cap(0.02), H),
      "--accent": css(best.L, best.C, H),
      "--on-accent": css(best.light ? 0.98 : 0.2, cap(0.02), H),
      "--soft": css(dark ? 0.32 : 0.93, cap(dark ? 0.04 : 0.03), H),
      "--emphasis": css(dark ? Math.min(0.86, best.L + 0.16) : Math.max(0.18, best.L - 0.12), best.C, H),
      "--muted-fill": css(dark ? 0.45 : 0.7, cap(0.02), H),
      "--scrim": dark ? "oklch(0.15 0.02 " + H.toFixed(2) + " / 0.62)" : "oklch(0.25 0.03 " + H.toFixed(2) + " / 0.42)"
    };
    Object.keys(tokens).forEach(function (key) { root.style.setProperty(key, tokens[key]); });
    root.setAttribute("data-appearance", mode);
    root.style.colorScheme = dark ? "dark" : "light";
    var accentRgb = oklchToRgb(best.L, best.C, H);
    var accentHex = "#" + accentRgb.map(function (c) {
      return Math.round(c * 255).toString(16).padStart(2, "0");
    }).join("");
    var theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.setAttribute("content", accentHex);
    var on = best.light ? "#f7fbfb" : "#102220";
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='" + accentHex + "'/><path d='M16 8v11M10.5 15.5 16 21l5.5-5.5' fill='none' stroke='" + on + "' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/></svg>";
    var link = document.getElementById("favicon");
    if (!link) {
      link = document.createElement("link");
      link.id = "favicon";
      link.rel = "icon";
      link.type = "image/svg+xml";
      document.head.appendChild(link);
    }
    link.href = "data:image/svg+xml," + encodeURIComponent(svg);
    Twui.accentHex = accentHex;
    Twui.onAccent = on;
    return true;
  }

  var Twui = window.Twui = window.Twui || {};
  Twui.VERSION = VERSION;
  Twui.DEFAULT_COLOUR = DEFAULT_COLOUR;
  Twui.DEFAULT_TITLE = DEFAULT_TITLE;
  Twui.appearance = appearance;
  Twui.colour = colour;
  Twui.title = title;
  Twui.hexToOklch = hexToOklch;
  Twui.applyTheme = applyTheme;
  Twui.darkMode = darkMode;
  Twui.saveAppearance = function (value) {
    localStorage.setItem("twui.appearance", value);
    Twui.appearance = value;
  };
  Twui.saveColour = function (hex) {
    localStorage.setItem("twui.baseColor", hex);
    Twui.colour = hex;
  };
  Twui.saveTitle = function (value) {
    var next = String(value || "").trim().slice(0, 80) || DEFAULT_TITLE;
    localStorage.setItem("twui.title", next);
    Twui.title = next;
    return next;
  };
  document.title = title;
  applyTheme(colour, appearance);
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", function () {
    if (Twui.appearance === "system") applyTheme(Twui.colour, "system");
  });
})();
