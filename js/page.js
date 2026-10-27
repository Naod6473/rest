(() => {
  const LISTE = MVBassin.STYLES, CLAIRS = ['calli', 'ukiyo', 'aqua', 'papier'];
  const menu = document.getElementById('menu'), plus = document.getElementById('plus');
  const NOMS = {}; menu.querySelectorAll('[data-s]').forEach((b) => { NOMS[b.dataset.s] = b.textContent; });
  const root = document.documentElement, stats = document.getElementById('stats');
  let auto = null;
  const eng = MVBassin.create(document.getElementById('bassin'), {
    avoid: '[data-evite]', decor: true, style: 'ascii',
    onStats: (s) => { stats.textContent = `${s.fish} poissons · ${s.food} granulés · ${s.eaten} mangés`; },
    onVisite: (k) => dire({ requin: 'Un requin passe… les koïs s\'écartent', raie: 'Une raie manta glisse sous l\'eau', tortue: 'Une tortue traverse le bassin' }[k]),
  });
  // petite annonce en haut de l'écran, qui s'efface seule
  const annonce = document.getElementById('annonce');
  let annonceT = 0;
  function dire(t) { annonce.textContent = t; annonce.classList.add('on'); clearTimeout(annonceT); annonceT = setTimeout(() => annonce.classList.remove('on'), 4500); }
  function choisir(s) {
    eng.setStyle(s); root.dataset.mode = CLAIRS.includes(s) ? 'calli' : 'neon';
    document.getElementById('nomStyle').textContent = NOMS[s];
    document.getElementById('techs').hidden = s !== 'calli';
    document.getElementById('aide').textContent = s === 'calli' ? 'Clic : nourrir · glisser : peindre dans l\'eau' : 'Clic : nourrir · glisser : dessiner dans l\'eau';
    document.querySelectorAll('[data-s]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === s)));
  }
  document.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => {
    eng.setTech(b.dataset.t);
    document.querySelectorAll('[data-t]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  document.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { arret(); choisir(b.dataset.s); ouvrirMenu(false); }));
  function ouvrirMenu(on) { menu.hidden = !on; plus.setAttribute('aria-expanded', String(on)); }
  plus.addEventListener('click', (e) => { e.stopPropagation(); ouvrirMenu(menu.hidden); });
  addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#menu, #plus')) ouvrirMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { ouvrirMenu(false); plus.focus(); } });
  const ba = document.getElementById('auto');
  function arret() { clearInterval(auto); auto = null; ba.setAttribute('aria-pressed', 'false'); }
  ba.addEventListener('click', () => {
    if (auto) return arret();
    ba.setAttribute('aria-pressed', 'true');
    const suiv = () => choisir(LISTE[(LISTE.indexOf(eng.style) + 1) % LISTE.length]);
    suiv(); auto = setInterval(suiv, 7000);
  });
  const vit = document.getElementById('vitesse'), vval = document.getElementById('vval');
  vit.addEventListener('input', () => { eng.setSpeed(+vit.value); vval.textContent = (+vit.value).toFixed(1).replace('.0', '') + '×'; });
  const panneau = document.getElementById('code'), srcEl = document.getElementById('source');
  let texte = '';
  async function ouvrir() {
    panneau.hidden = false; document.getElementById('fermer').focus();
    if (texte) return;
    const inline = document.getElementById('moteur');
    try { texte = inline ? inline.textContent.trim() : await (await fetch('js/bassin.js')).text(); }
    catch (e) { texte = '// Impossible de charger le code : voir le dépôt GitHub.'; }
    srcEl.textContent = texte;
    document.getElementById('lignes').textContent = texte.split('\n').length + ' lignes';
  }
  function fermer() { panneau.hidden = true; document.getElementById('voirCode').focus(); }
  document.getElementById('voirCode').addEventListener('click', ouvrir);
  document.getElementById('fermer').addEventListener('click', fermer);
  panneau.addEventListener('click', (e) => { if (e.target === panneau) fermer(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panneau.hidden) fermer(); });
  document.getElementById('copier').addEventListener('click', (e) => {
    const b = e.currentTarget;
    navigator.clipboard.writeText(texte).then(() => { b.textContent = 'Copié ✓'; }, () => {
      const r = document.createRange(); r.selectNodeContents(srcEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Sélectionné';
    }).finally(() => setTimeout(() => { b.textContent = 'Copier'; }, 1600));
  });
  // musique : cinq morceaux libres de droits enchaînés ; le navigateur exige souvent un premier geste avant le son
  const PISTES = [1, 2, 3, 4, 5].map((n) => `audio/musique-${n}.mp3`), son = document.getElementById('son'), audio = new Audio();
  let piste = Math.random() * PISTES.length | 0, voulu = true, fondu = 0;
  try { voulu = localStorage.getItem('koi-son') !== '0'; } catch (e) { /* stockage indisponible */ }
  audio.preload = 'none'; audio.volume = 0;
  function volume(cible) {
    cancelAnimationFrame(fondu);
    (function pas() {
      const v = audio.volume + Math.sign(cible - audio.volume) * (cible > audio.volume ? .008 : .02);
      if (Math.abs(cible - audio.volume) <= .02) { audio.volume = cible; if (!cible) audio.pause(); return; }
      audio.volume = Math.min(1, Math.max(0, v)); fondu = requestAnimationFrame(pas);
    })();
  }
  function jouer() {
    if (!voulu || document.hidden) return;
    if (!audio.src) audio.src = PISTES[piste];
    audio.play().then(() => { son.setAttribute('aria-pressed', 'true'); volume(.35); }).catch(() => {});
  }
  audio.addEventListener('ended', () => { piste = (piste + 1) % PISTES.length; audio.src = PISTES[piste]; jouer(); });
  son.addEventListener('click', () => {
    voulu = !(son.getAttribute('aria-pressed') === 'true');
    try { localStorage.setItem('koi-son', voulu ? '1' : '0'); } catch (e) { /* tant pis */ }
    son.setAttribute('aria-pressed', String(voulu));
    if (voulu) jouer(); else volume(0);
  });
  const premierGeste = (e) => { if (e.target.closest && e.target.closest('#son')) return; if (audio.paused) jouer(); removeEventListener('pointerdown', premierGeste); removeEventListener('keydown', premierGeste); };
  addEventListener('pointerdown', premierGeste); addEventListener('keydown', premierGeste);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); else if (voulu && audio.src) jouer(); });
  jouer();
  // souffle : le micro est écouté seulement après un clic, analysé sur place, et rien n'est enregistré ni envoyé
  const bs = document.getElementById('souffle');
  let micro = null;
  function coupe() {
    if (!micro) return;
    cancelAnimationFrame(micro.raf); micro.flux.getTracks().forEach((t) => t.stop()); micro.ac.close().catch(() => {});
    micro = null; eng.souffle(0); bs.setAttribute('aria-pressed', 'false');
  }
  bs.addEventListener('click', async () => {
    if (micro) { coupe(); dire('Micro coupé'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { dire('Pas de micro disponible sur ce navigateur'); return; }
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const ac = new (window.AudioContext || window.webkitAudioContext)(), an = ac.createAnalyser();
      an.fftSize = 1024; an.smoothingTimeConstant = .3; ac.createMediaStreamSource(flux).connect(an);
      const spec = new Uint8Array(an.frequencyBinCount), hz = ac.sampleRate / an.fftSize;
      const lo = Math.max(1, Math.round(60 / hz)), mi = Math.round(500 / hz), hi = Math.round(4000 / hz);
      let fond = 60;
      micro = { flux, ac, raf: 0 };
      (function tour() {
        an.getByteFrequencyData(spec);
        let g = 0, a = 0;
        for (let i = lo; i < mi; i++) g += spec[i];
        for (let i = mi; i < hi; i++) a += spec[i];
        g /= mi - lo; a /= hi - mi;
        // le bruit de la pièce est appris doucement ; un souffle sature les graves et déborde dans les aigus
        fond += (g - fond) * (g < fond ? .05 : .002);
        const n = (g - Math.max(fond + 25, 105)) / 70 * (a > 40 ? 1 : .4);
        eng.souffle(Math.max(0, Math.min(1, n)));
        micro.raf = requestAnimationFrame(tour);
      })();
      bs.setAttribute('aria-pressed', 'true');
      dire('Souffle vers l\'écran pour faire fuir les koïs');
    } catch (e) { coupe(); dire('Micro refusé : le bassin reste calme'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) coupe(); });
  // toute l'interface s'estompe après quelques secondes sans geste, et revient au moindre mouvement
  let calme = 0, survol = false;
  const occupe = () => survol || !menu.hidden || !panneau.hidden || document.activeElement && document.activeElement.closest && document.activeElement.closest('.barre, .techs, .menu');
  function reveil() { root.classList.remove('calme'); clearTimeout(calme); calme = setTimeout(function dort() { if (occupe()) calme = setTimeout(dort, 1500); else root.classList.add('calme'); }, 3500); }
  document.querySelectorAll('.barre, .techs, .menu').forEach((el) => { el.addEventListener('pointerenter', () => { survol = true; }); el.addEventListener('pointerleave', () => { survol = false; }); });
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, reveil, { passive: true }));
  reveil();
  let clics = 0;
  addEventListener('click', (e) => { if (!e.target.closest('button, .code, .vitesse') && ++clics > 2) document.getElementById('aide').style.opacity = 0; });
  window.bassin = { choisir, eng, dire };
})();
