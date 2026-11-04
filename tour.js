// Les captures expliquées : une zone de l'écran s'éclaire à la fois, le reste s'assombrit, et la
// légende correspondante passe au premier plan. Ça avance seul quand la capture est à l'écran ;
// survoler ou toucher une légende la montre tout de suite.
(function () {
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-tour]").forEach(function (fig) {
    var spots = fig.querySelectorAll(".spot");
    var notes = fig.querySelectorAll(".notes li");
    var n = Math.min(spots.length, notes.length);
    if (!n) return;
    var index = 0, timer = null, held = false;
    // Une seule loupe qui glisse d'une zone à l'autre (les .spot ne servent qu'à décrire les zones).
    var lens = document.createElement("span");
    lens.className = "lens";
    spots[0].parentNode.appendChild(lens);
    function show(i) {
      index = i;
      var st = spots[i].style;
      ["--x", "--y", "--w", "--h"].forEach(function (v) { lens.style.setProperty(v, st.getPropertyValue(v)); });
      for (var k = 0; k < n; k++) {
        notes[k].classList.toggle("on", k === i);
        notes[k].setAttribute("aria-current", k === i ? "true" : "false");
      }
    }
    function start() {
      if (reduced || timer) return;
      timer = setInterval(function () { if (!held) show((index + 1) % n); }, 3400);
    }
    function stop() { clearInterval(timer); timer = null; }
    for (var k = 0; k < n; k++) {
      (function (i) {
        var li = notes[i];
        li.tabIndex = 0;
        li.addEventListener("mouseenter", function () { held = true; show(i); });
        li.addEventListener("mouseleave", function () { held = false; });
        li.addEventListener("focus", function () { held = true; show(i); });
        li.addEventListener("blur", function () { held = false; });
        li.addEventListener("click", function () { show(i); });
      })(k);
    }
    show(0);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries[0].isIntersecting ? start() : stop();
      }, { threshold: 0.5 }).observe(fig);
    }
  });
})();
