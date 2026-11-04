// Les téléchargements : le bon bouton en avant selon l'appareil, et les vrais fichiers de la
// dernière release (Mac et Windows dans la même), versions comprises.
(function () {
  // Le lien public de la bêta TestFlight. Vide : le bouton iPhone demande l'accès par courriel.
  var TESTFLIGHT = "https://testflight.apple.com/join/6kj3rHyM";
  var RELEASE_API = "https://api.github.com/repos/hchzr/studytrack-site/releases/latest";

  function set(id, prop, value) {
    var el = document.getElementById(id);
    if (el && value) { el[prop] = value; }
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

  // Avec le lien public, l'iPhone parle de TestFlight ; sans lui, d'une demande par courriel.
  var iphone = document.getElementById("dl-iphone");
  if (TESTFLIGHT && iphone) {
    iphone.href = TESTFLIGHT;
    iphone.textContent = "Rejoindre la bêta";
    set("ver-iphone", "textContent", "Bêta publique sur TestFlight");
    document.querySelectorAll("[data-tf-label]").forEach(function (el) { el.textContent = "Bêta TestFlight"; });
    var steps = document.getElementById("steps-iphone");
    if (steps) {
      steps.innerHTML = '<li>Installe <a href="https://apps.apple.com/app/testflight/id899247664">TestFlight</a> depuis l\'App Store.</li>'
        + "<li>Ouvre le lien de la bêta sur ton iPhone.</li>"
        + "<li>Touche « Installer » : les mises à jour arrivent seules.</li>";
    }
  }

  // Les boutons du haut mènent droit au fichier quand on le connaît.
  function direct(name, href) {
    var el = document.querySelector('.get [data-platform="' + name + '"]');
    if (el && href) { el.href = href; }
  }
  if (TESTFLIGHT) { direct("iphone", TESTFLIGHT); }

  fetch("mac/latest.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (feed) {
      if (!feed || !feed.url) { return; }
      set("dl-mac", "href", feed.url);
      direct("mac", feed.url);
      set("ver-mac", "textContent", "Version " + feed.version + " (" + feed.build + ") · macOS 14 ou plus récent");
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
        set("exe-name", "textContent", exe.name);
        var m = exe.name.match(/_(\d+(?:\.\d+)+)_/);
        if (m) { set("ver-win", "textContent", "Version " + m[1] + " · Windows 10 et 11, 64 bits"); }
      }
      if (msi) { set("dl-msi", "href", msi.browser_download_url); }
    })
    .catch(function () {});
})();
