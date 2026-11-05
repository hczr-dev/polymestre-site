// Les téléchargements : le bon bouton en avant selon l'appareil, et les vrais fichiers de la
// dernière release (Mac et Windows dans la même), versions comprises.
(function () {
  var RELEASE_API = "https://api.github.com/repos/hczr-dev/studytrack-site/releases/latest";

  function set(id, prop, value) {
    var el = document.getElementById(id);
    if (el && value) { el[prop] = value; }
  }

  // « Version 2.1 (6) · … » : la phrase vient de la page (data-known, traduite dans i18n/strings.toml).
  function version(id, values) {
    var el = document.getElementById(id);
    if (!el || !el.dataset.known) { return; }
    el.textContent = el.dataset.known.replace(/\{(\w+)\}/g, function (all, k) { return values[k] != null ? values[k] : all; });
  }

  var ua = navigator.userAgent;
  var touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  var platform = /iPhone|iPod/.test(ua) ? "iphone"
    : (/iPad/.test(ua) || touchMac) ? "iphone"
    : /Mac OS X|Macintosh/.test(ua) ? "mac"
    : /Windows/.test(ua) ? "windows" : null;
  if (platform) {
    document.querySelectorAll('[data-platform="' + platform + '"]').forEach(function (el) { el.classList.add("you"); });
  }

  // Les boutons du haut mènent droit au fichier quand on le connaît.
  function direct(name, href) {
    var el = document.querySelector('.get [data-platform="' + name + '"]');
    if (el && href) { el.href = href; }
  }

  fetch("mac/latest.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (feed) {
      if (!feed || !feed.url) { return; }
      set("dl-mac", "href", feed.url);
      direct("mac", feed.url);
      version("ver-mac", { version: feed.version, build: feed.build });
    })
    .catch(function () {});

  fetch(RELEASE_API, { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (release) {
      if (!release || !release.assets) { return; }
      var exe = null, msi = null;
      release.assets.forEach(function (a) {
        if (/-setup\.exe$/i.test(a.name)) { exe = a; }
        if (/\.msi$/i.test(a.name)) { msi = a; }
      });
      if (exe) {
        set("dl-win", "href", exe.browser_download_url);
        direct("windows", exe.browser_download_url);
        var m = exe.name.match(/_(\d+(?:\.\d+)+)_/);
        if (m) { version("ver-win", { version: m[1] }); }
      }
      if (msi) { set("dl-msi", "href", msi.browser_download_url); }
    })
    .catch(function () {});
})();
