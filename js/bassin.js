// ===== Bassin de koïs : moteur =====
// Des carpes koï nagent sur un canvas 2D, contournent les éléments marqués [data-evite] et se nourrissent d'un clic.
// Rendus : néon, ASCII, code, calligraphie (sumi-e, lavis, pinceau, mouillé, papier, contour), plus pixel, matrix,
// encre, plan, htop, holo et thermique. Aucune dépendance, aucune requête externe.
// API : MVBassin.create(canvas, { avoid, onStats, decor, onVisite }) -> { setStyle, setTech, setSpeed, setAuto, setVis, souffle, visite, destroy }
// Souffle (micro) : souffle(niveau 0..1) fait fuir les carpes et ride l'eau. De temps en temps un requin, une raie ou une tortue passe.
// Glisser dans l'eau peint un trait que les carpes viennent voir. Respecte prefers-reduced-motion.
(() => {
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const rand = (a, b) => a + Math.random() * (b - a);
    const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

    // Robe d'un poisson : corps + accent (nageoires, ligne dorsale)
    const ROBES = [['#2ef2ff', '#b26bff'], ['#4d7cff', '#2ef2ff'], ['#b26bff', '#4d7cff'], ['#2ef2ff', '#4d7cff'], ['#8f7bff', '#2ef2ff']];
    const RARE = ['#ff6bd5', '#2ef2ff'];
    // Visiteurs rares : ils traversent le bassin de temps en temps. art = indices des palettes peintes (corps, nageoires)
    const VISIT = {
        requin: { robe: ['#9fb8d0', '#5d7894'], scale: 1.7, w: .085, speed: 48, depth: .95, art: [2, 2], ink: 2 },
        raie: { robe: ['#7b8cff', '#2ef2ff'], scale: 1.15, w: .1, speed: 34, depth: .7, art: [2, 1], ink: 2 },
        tortue: { robe: ['#5af78e', '#2ef2ff'], scale: .95, w: .12, speed: 26, depth: .85, art: [3, 2], ink: 3 },
    };
    const NODES = 16;
    const STYLES = ['neon', 'ascii', 'code', 'pixel', 'matrix', 'encre', 'plan', 'htop', 'holo', 'thermique', 'calli', 'ukiyo', 'or', 'aqua', 'papier', 'vitrail', 'abysses', 'mosaique'];
    // Calligraphie : robes de koï peintes à l'encre (0 blanc, 1 vermillon, 2 sumi, 3 ocre)
    const INKC = [[70, 64, 58], [196, 50, 26], [24, 22, 26], [190, 128, 38]];
    const VARIETES = ['kohaku', 'karasu', 'sanke', 'higoi', 'showa', 'tancho', 'ogon', 'kohaku'];
    const ink = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const RAMP = ' .:-=+*#%@';
    const KATA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789<>=+*';
    // rendu « code » : une suite de signes tirés au hasard à chaque chargement
    const SIGNES = 'abcdefghijklmnopqrstuvwxyz0123456789{}()[]<>;:=+-*/&|!?._$#%~^';
    const CODE = Array.from({ length: 997 }, () => (Math.random() < .14 ? ' ' : SIGNES[Math.random() * SIGNES.length | 0])).join('');
    // Tramage ordonné 4x4 du rendu pixel art
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const FONT = '"Share Tech Mono", ui-monospace, monospace';

    function create(cv, opts) {
        opts = opts || {};
        const ctx = cv.getContext('2d');
        const reduce = matchMedia('(prefers-reduced-motion: reduce)');
        const S = { W: 0, H: 0, dpr: 1, t: 0, fish: [], food: [], rings: [], sparks: [], bubbles: [], boxes: [], eaten: 0, rare: false, ripples: [], gusts: [], wind: { level: 0, x: 0, y: 0, acc: 0 }, nextVisit: rand(70, 140),
            tech: 'sumie', spd: 1, style: opts.style || 'neon', prev: opts.style || 'neon', trans: 1, auto: false, autoT: 0, sorted: [], vis: 1, visTarget: 1, frame: 0 };
        const ptr = { x: -999, y: -999, speed: 0, active: false, lt: 0 };
        const stats = () => opts.onStats && opts.onStats({ fish: S.fish.length, food: S.food.length, eaten: S.eaten, style: S.style });

        // ---------- poissons ----------
        function makeFish(robe, scale) {
            const len = clamp(Math.min(S.W, S.H) * .24, 90, 210) * scale;
            const x = rand(S.W * .1, S.W * .9), y = rand(S.H * .15, S.H * .9), h = rand(0, TAU), seg = len / (NODES - 1);
            const nodes = [];
            for (let i = 0; i < NODES; i++) nodes.push({ x: x - Math.cos(h) * seg * i, y: y - Math.sin(h) * seg * i });
            return { nodes, seg, len, w: len * .11, h, speed: rand(35, 60), base: rand(38, 62), phase: rand(0, TAU), wander: 0,
                curiosity: rand(.3, 1), depth: rand(.55, 1), robe, target: null, startle: 0, rush: 0, heat: .25, pid: 100 + (Math.random() * 900 | 0) };
        }
        function seed() {
            if (opts.passage) {
                // un seul poisson, qui entre par un bord et sort par l'autre
                const f = makeFish(ROBES[Math.random() * ROBES.length | 0], rand(1.2, 1.45)), right = Math.random() < .5;
                f.w = f.len * .15; f.h = right ? 0 : Math.PI; f.depth = 1; f.base = rand(55, 75); f.dir = right ? 1 : -1;
                const x = right ? -f.len * .2 : S.W + f.len * .2, y = rand(S.H * .2, S.H * .8);
                f.nodes.forEach((nd, i) => { nd.x = x - Math.cos(f.h) * f.seg * i; nd.y = y; });
                S.fish.push(f);
                return;
            }
            const n = clamp(Math.round(S.W * S.H / 210000), 3, 7);
            for (let i = 0; i < n; i++) S.fish.push(makeFish(ROBES[i % ROBES.length], rand(.7, 1.05)));
            for (let i = 0; i < (S.W > 900 ? 2 : 1); i++) { const f = makeFish(ROBES[(i + 2) % ROBES.length], rand(.38, .5)); f.depth = .45; S.fish.push(f); }
            for (let i = 0; i < 14; i++) S.bubbles.push({ x: rand(0, S.W), y: rand(0, S.H), r: rand(1, 2.6), v: rand(8, 22), p: rand(0, TAU) });
        }

        function resize() {
            const first = S.W === 0;
            S.W = innerWidth; S.H = innerHeight; S.dpr = Math.min(devicePixelRatio || 1, 2);
            cv.width = Math.round(S.W * S.dpr); cv.height = Math.round(S.H * S.dpr);
            if (first) seed();
            sizeGrids();
            measure();
            stats();
        }

        // Le contenu à contourner (cartes, photo, en-tête…), en coordonnées d'écran
        function measure() {
            S.boxes = [];
            if (!opts.avoid) return;
            document.querySelectorAll(opts.avoid).forEach((el) => {
                if (el.closest('[hidden]')) return;
                const b = el.getBoundingClientRect();
                if (!b.width || b.bottom < -50 || b.top > S.H + 50) return;
                S.boxes.push({ l: b.left, t: b.top, r: b.right, b: b.bottom });
            });
        }
        function repel(x, y, margin) {
            let fx = 0, fy = 0;
            for (const b of S.boxes) {
                let ox = x - clamp(x, b.l, b.r), oy = y - clamp(y, b.t, b.b), d = Math.hypot(ox, oy);
                if (d > margin) continue;
                if (d < .001) {
                    const e = [b.l - x, x - b.r, b.t - y, y - b.b], k = e.indexOf(Math.max(...e));
                    ox = k === 0 ? -1 : k === 1 ? 1 : 0; oy = k === 2 ? -1 : k === 3 ? 1 : 0; d = 0;
                }
                const L = Math.hypot(ox, oy) || 1, s = 1 - d / margin;
                fx += ox / L * s; fy += oy / L * s;
            }
            return [fx, fy];
        }
        const insideBox = (x, y) => S.boxes.some((b) => x > b.l && x < b.r && y > b.t && y < b.b);

        // cap, vitesse et ondulation ; le corps suit la tête nœud par nœud
        function steer(f, vx, vy, dt) {
            const hd = f.nodes[0], turn = .85 + f.rush * 2 + f.startle * 3.5;
            f.h += S.spd * clamp(angDiff(f.h, Math.atan2(vy, vx)), -turn * dt, turn * dt);
            f.startle = Math.max(0, f.startle - dt * .6);
            f.rush = f.target ? Math.min(1, f.rush + dt * 2) : Math.max(0, f.rush - dt * .5);
            f.speed += (f.base * (1 + f.rush * 1.6 + f.startle * 3.2) - f.speed) * Math.min(1, dt * 2.5);
            f.phase += dt * (3 + f.speed * .07) * (.4 + .6 * S.spd) * (f.kind ? .55 : 1);
            f.heat += (.25 + f.rush * .35 - f.heat) * Math.min(1, dt * .25);
            hd.x += Math.cos(f.h) * f.speed * dt * S.spd; hd.y += Math.sin(f.h) * f.speed * dt * S.spd;
            for (let i = 1; i < NODES; i++) {
                const a = f.nodes[i - 1], b = f.nodes[i], dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
                if (d > f.seg) { b.x = a.x - dx / d * f.seg; b.y = a.y - dy / d * f.seg; }
            }
        }

        // Un visiteur rare entre par un bord et traverse le bassin
        function visit(kind) {
            if (!VISIT[kind]) kind = ['requin', 'requin', 'raie', 'tortue'][Math.random() * 4 | 0];
            const V = VISIT[kind], f = makeFish(V.robe, V.scale), right = Math.random() < .5;
            Object.assign(f, { kind, w: f.len * V.w, dir: right ? 1 : -1, h: right ? 0 : Math.PI, depth: V.depth, base: V.speed, speed: V.speed, curiosity: 0 });
            const x = right ? -f.len * .3 : S.W + f.len * .3, y = rand(S.H * .25, S.H * .75);
            f.nodes.forEach((nd, i) => { nd.x = x - Math.cos(f.h) * f.seg * i; nd.y = y; });
            f.koi = koiRobe(f); f.z = f.zT = 0; f.zNext = Infinity;
            S.fish.push(f);
            stats();
            if (opts.onVisite) opts.onVisite(kind);
        }

        // Souffle : rides qui partent du point soufflé, risées en arcs, granulés poussés
        function wind(dt) {
            const wd = S.wind;
            S.ripples = S.ripples.filter((r) => S.t - r.born < r.life);
            S.gusts = S.gusts.filter((q) => S.t - q.born < q.life);
            wd.level = Math.max(0, wd.level - dt * .4);
            if (wd.level < .12) return;
            const R = 120 + 380 * wd.level;
            wd.acc += dt * wd.level * 9;
            while (wd.acc > 1) {
                wd.acc--;
                const an = rand(0, TAU), d = Math.sqrt(Math.random()) * R * .7;
                S.ripples.push({ x: wd.x + Math.cos(an) * d, y: wd.y + Math.sin(an) * d * .75, born: S.t, life: rand(1.6, 2.6), s: rand(.6, 1.2) * (.6 + wd.level) });
            }
            for (let k = 0; k < wd.level * 3; k++) {
                if (Math.random() > dt * 18) continue;
                S.gusts.push({ an: rand(0, TAU), d0: rand(10, 60), v: rand(140, 260) * (.5 + wd.level), w: rand(.15, .4), born: S.t, life: rand(.9, 1.6), x: wd.x, y: wd.y });
            }
            for (const p of S.food) {
                const dx = p.x - wd.x, dy = p.y - wd.y, d = Math.hypot(dx, dy) || 1;
                if (d < R * 1.5) { p.vx += dx / d * 90 * wd.level * dt; p.vy += dy / d * 90 * wd.level * dt; }
            }
        }

        function step(dt) {
            S.t += dt;
            ptr.speed *= Math.exp(-dt * 8);
            const { W, H } = S;
            // ce qui fait peur : le souffle et les requins
            const wd = S.wind, dangers = [];
            if (wd.level > .12) dangers.push({ x: wd.x, y: wd.y, r: 220 + 520 * wd.level, k: wd.level * 1.6 });
            for (const v of S.fish) if (v.kind === 'requin') dangers.push({ x: v.nodes[3].x, y: v.nodes[3].y, r: v.len * 1.3, k: 1 });
            for (const f of S.fish) {
                const hd = f.nodes[0];
                let vx = Math.cos(f.h), vy = Math.sin(f.h);
                f.wander = clamp(f.wander + rand(-1, 1) * dt * .9, -1, 1);
                const wa = f.h + f.wander * .7;
                vx += Math.cos(wa) * .8; vy += Math.sin(wa) * .8;
                const m = 90;
                if (f.dir) vx += f.dir * 1.1;
                else {
                    if (hd.x < m) vx += (m - hd.x) / m * 3;
                    if (hd.x > W - m) vx -= (hd.x - (W - m)) / m * 3;
                }
                if (hd.y < m) vy += (m - hd.y) / m * 3;
                if (hd.y > H - m) vy -= (hd.y - (H - m)) / m * 3;
                const [rx, ry] = repel(hd.x, hd.y, 55); vx += rx * 1.4; vy += ry * 1.4;
                if (f.kind) {
                    // un visiteur garde son cap : il entre d'un côté et ressort de l'autre
                    f.wander *= .5;
                    vy += Math.sin(S.t * .3 + f.pid) * .4;
                    steer(f, vx, vy, dt);
                    continue;
                }
                for (const d of dangers) {
                    const dx = hd.x - d.x, dy = hd.y - d.y, dd = Math.hypot(dx, dy) || 1;
                    if (dd > d.r) continue;
                    const k = (1 - dd / d.r) * d.k;
                    vx += dx / dd * k * 6; vy += dy / dd * k * 6;
                    f.startle = Math.max(f.startle, Math.min(1, k * 1.2));
                    if (f.dance) f.dance = null;
                }

                // danse yin-yang (calligraphie) : deux carpes se poursuivent sur un cercle
                if (f.dance) {
                    if (S.t > f.dance.end || S.food.length) f.dance = null;
                    else {
                        const d = f.dance, th = (S.t - d.t0) * .9 * d.dir + d.off + d.dir * .6;
                        const dx = d.cx + Math.cos(th) * d.R - hd.x, dy = d.cy + Math.sin(th) * d.R - hd.y, dd = Math.hypot(dx, dy) || 1;
                        vx += dx / dd * 3.4; vy += dy / dd * 3.4;
                    }
                }
                // nourriture : chaque poisson garde son granulé tant qu'il existe
                if (f.target && !S.food.includes(f.target)) f.target = null;
                if (!f.target && S.food.length) {
                    let best = null, bd = 700;
                    for (const p of S.food) { const d = Math.hypot(p.x - hd.x, p.y - hd.y); if (d < bd) { bd = d; best = p; } }
                    f.target = best;
                }
                if (f.target) {
                    const dx = f.target.x - hd.x, dy = f.target.y - hd.y, d = Math.hypot(dx, dy) || 1;
                    vx += dx / d * 3.5; vy += dy / d * 3.5;
                    if (d < 12 + f.w * .3) eat(f, f.target);
                } else if (S.lure && S.t - S.lure.t < 3) {
                    const dx = S.lure.x - hd.x, dy = S.lure.y - hd.y, d = Math.hypot(dx, dy);
                    if (d < 450 && d > 40) { vx += dx / d * 1.8 * f.curiosity; vy += dy / d * 1.8 * f.curiosity; }
                } else if (ptr.active) {
                    const dx = ptr.x - hd.x, dy = ptr.y - hd.y, d = Math.hypot(dx, dy);
                    if (d < 320 && d > 50) { vx += dx / d * f.curiosity * .9; vy += dy / d * f.curiosity * .9; }
                    if (d < 150 && ptr.speed > 1400 && f.startle < .2) f.startle = 1;
                    if (f.startle > .5 && d > 0) { vx -= dx / d * 4 * f.startle; vy -= dy / d * 4 * f.startle; }
                }

                steer(f, vx, vy, dt);
            }
            for (const f of S.fish) {
                if (!f.kind) continue;
                const tail = f.nodes[NODES - 1];
                if (f.dir > 0 ? tail.x > W + f.len * .5 : tail.x < -f.len * .5) f.gone = true;
            }
            if (S.fish.some((f) => f.gone)) { S.fish = S.fish.filter((f) => !f.gone); stats(); }
            if (!opts.passage && opts.decor && S.t > S.nextVisit) { S.nextVisit = S.t + rand(150, 330); visit(); }
            wind(dt);
            if (opts.passage && !S.done) {
                const f0 = S.fish[0], tail = f0.nodes[NODES - 1];
                if (f0.dir > 0 ? tail.x > W + 60 : tail.x < -60) { S.done = true; if (opts.onDone) setTimeout(opts.onDone, 0); }
            }
            const n0 = S.food.length;
            S.food = S.food.filter((p) => S.t - p.born < 12);
            if (S.food.length !== n0) stats();
            for (const p of S.food) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .99; p.vy *= .99; }
            S.rings = S.rings.filter((r) => S.t - r.born < 1.6);
            S.sparks = S.sparks.filter((s) => S.t - s.born < .5);
            for (const b of S.bubbles) { b.y -= b.v * dt; b.x += Math.sin(S.t + b.p) * 6 * dt; if (b.y < -10) { b.y = S.H + 10; b.x = rand(0, S.W); } }
            for (const d of grid.drops) { d.y += d.v * dt; if (d.y > grid.rows + 18) { d.y = rand(-20, 0); d.v = rand(6, 16); } }
            const g = grid.glyphs, n = g ? g.length : 0;
            for (let k = 0; k < n * .02; k++) g[Math.random() * n | 0] = Math.random() * KATA.length | 0;
        }

        // Après 25 granulés croqués, un poisson rose rare arrive par la gauche : c'est le secret
        function eat(f, p) {
            S.food = S.food.filter((q) => q !== p);
            S.sparks.push({ x: p.x, y: p.y, born: S.t, c: f.robe[0] });
            f.target = null; S.eaten++; f.heat = Math.min(1, f.heat + .35);
            if (S.eaten >= 25 && !S.rare) {
                S.rare = true;
                const r = makeFish(RARE, .8);
                r.nodes.forEach((n) => { n.x = -60; n.y = S.H * .5; }); r.h = 0; r.depth = 1; r.base = 70;
                S.fish.push(r);
                if (opts.onRare) opts.onRare();
            }
            stats();
        }

        function feed(x, y) {
            S.rings.push({ x, y, born: S.t, s: 1 });
            const k = Math.min(5 + (Math.random() * 3 | 0), 24 - S.food.length);
            for (let i = 0; i < k; i++) {
                const an = rand(0, TAU), r = Math.sqrt(Math.random()) * 30;
                S.food.push({ x: x + Math.cos(an) * r * 1.3, y: y + Math.sin(an) * r, born: S.t + i * .04, vx: Math.cos(an) * 4, vy: Math.sin(an) * 4,
                    r: rand(2.6, 3.9), rot: rand(0, TAU), k: Math.random(), bob: rand(0, TAU) });
            }
            for (const f of S.fish) if (Math.hypot(f.nodes[0].x - x, f.nodes[0].y - y) < 650) f.rush = 1;
            stats();
        }

        // ---------- dessin vectoriel (néon) ----------
        function spine(f) {
            const pts = [], amp = f.w * (.5 + Math.min(f.speed, 140) / 140);
            for (let i = 0; i < NODES; i++) {
                const a = f.nodes[Math.max(0, i - 1)], b = f.nodes[Math.min(NODES - 1, i + 1)];
                let tx = a.x - b.x, ty = a.y - b.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
                const u = i / (NODES - 1), off = Math.sin(f.phase - u * 4.2) * amp * u * u, n = f.nodes[i];
                pts.push({ x: n.x - ty * off, y: n.y + tx * off, tx, ty, u });
            }
            return pts;
        }
        const width = (f, u) => f.w * Math.pow(Math.sin(Math.PI * clamp(u * .92 + .07, 0, 1)), .75) * (1.15 - u * .6);

        let NG = ctx;
        function neon(path, color, lw, alpha) {
            NG.strokeStyle = color;
            NG.globalAlpha = alpha * .14; NG.lineWidth = lw * 7; path(); NG.stroke();
            NG.globalAlpha = alpha * .3; NG.lineWidth = lw * 3; NG.stroke();
            NG.globalAlpha = alpha * .95; NG.lineWidth = lw; NG.stroke();
            NG.strokeStyle = '#ffffff'; NG.globalAlpha = alpha * .45; NG.lineWidth = lw * .4; NG.stroke();
        }

        // g = contexte cible ; mask = silhouette pleine pour les rendus en grille
        // over = couleurs imposées { c1, c2, eye } (masque thermique, hologramme)
        function drawFish(f, vis, g, mask, over) {
            if (f.kind) { drawVisitor(f, vis, g, mask, over); return; }
            const P = spine(f), c1 = over ? over.c1 : f.robe[0], c2 = over ? over.c2 : f.robe[1], hd = P[0];
            let a = vis * (.45 + .55 * f.depth);
            if (insideBox(hd.x, hd.y)) a *= .4;
            const lw = Math.max(1, f.w * .09), L = [], R = [];
            for (const p of P) { const w = width(f, p.u); L.push({ x: p.x - p.ty * w, y: p.y + p.tx * w }); R.push({ x: p.x + p.ty * w, y: p.y - p.tx * w }); }
            const body = () => {
                g.beginPath();
                const sx = hd.x + hd.tx * f.w * .55, sy = hd.y + hd.ty * f.w * .55;
                g.moveTo(sx, sy);
                g.quadraticCurveTo(L[0].x + hd.tx * f.w * .4, L[0].y + hd.ty * f.w * .4, L[1].x, L[1].y);
                for (let i = 1; i < NODES - 1; i++) g.quadraticCurveTo(L[i].x, L[i].y, (L[i].x + L[i + 1].x) / 2, (L[i].y + L[i + 1].y) / 2);
                g.lineTo(R[NODES - 1].x, R[NODES - 1].y);
                for (let i = NODES - 2; i > 0; i--) g.quadraticCurveTo(R[i + 1].x, R[i + 1].y, (R[i].x + R[i + 1].x) / 2, (R[i].y + R[i + 1].y) / 2);
                g.quadraticCurveTo(R[0].x + hd.tx * f.w * .4, R[0].y + hd.ty * f.w * .4, sx, sy);
                g.closePath();
            };
            // queue en éventail
            const T = P[NODES - 1], bx = -T.tx, by = -T.ty, fl = f.len * .3, sw = Math.sin(f.phase - 4.4) * .35, ba = Math.atan2(by, bx);
            const tip = (s) => ({ x: T.x + Math.cos(ba + s * .5 + sw) * fl, y: T.y + Math.sin(ba + s * .5 + sw) * fl });
            const t1 = tip(1), t2 = tip(-1), nx = T.x + bx * fl * .45 + Math.cos(ba + sw) * 2, ny = T.y + by * fl * .45;
            const tail = () => {
                g.beginPath(); g.moveTo(T.x, T.y);
                g.quadraticCurveTo((T.x + t1.x) / 2 - by * fl * .12, (T.y + t1.y) / 2 + bx * fl * .12, t1.x, t1.y);
                g.quadraticCurveTo(nx, ny, t2.x, t2.y);
                g.quadraticCurveTo((T.x + t2.x) / 2 + by * fl * .12, (T.y + t2.y) / 2 - bx * fl * .12, T.x, T.y);
            };
            // nageoires pectorales
            const fin = (side) => {
                const p = P[3], w = width(f, p.u), sway = Math.sin(f.phase * .7 + side) * .25;
                const ox = p.x - side * p.ty * w, oy = p.y + side * p.tx * w, an = Math.atan2(-p.ty, -p.tx) + side * (1 + sway);
                const fx = ox + Math.cos(an) * f.w * 2.1, fy = oy + Math.sin(an) * f.w * 2.1;
                return Object.assign(() => {
                    g.beginPath(); g.moveTo(ox, oy);
                    g.quadraticCurveTo(ox + Math.cos(an - side * .5) * f.w * 1.6, oy + Math.sin(an - side * .5) * f.w * 1.6, fx, fy);
                    g.quadraticCurveTo(ox + Math.cos(an + side * .4) * f.w * 1.2, oy + Math.sin(an + side * .4) * f.w * 1.2, P[5].x, P[5].y);
                }, { ox, oy, an });
            };
            const eyes = (s) => { const w = width(f, P[1].u) * .62; return [P[1].x - s * P[1].ty * w + hd.tx * f.w * .1, P[1].y + s * P[1].tx * w + hd.ty * f.w * .1]; };

            g.save();
            if (mask === 'calli') { drawCalli(f, g, a, P, L, R, body, tail, fin, eyes, { T, ba, sw, fl }); g.restore(); return; }
            if (typeof mask === 'string' && ART[mask]) { ART[mask]({ f, g, a: mask === 'mosaique' ? 1 : a, P, L, R, body, tail, fin, eyes, lw, hd, T, ba, sw, fl }); g.restore(); return; }
            if (mask === 'encre') {
                // pinceau : lavis translucide puis contour calligraphique clair
                g.globalCompositeOperation = 'lighter';
                g.globalAlpha = a * .22; g.fillStyle = c1; body(); g.fill();
                g.globalAlpha = a * .16; g.fillStyle = c2; tail(); g.fill();
                for (const s of [1, -1]) { fin(s)(); g.fill(); }
                g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#e8ecff';
                g.globalAlpha = a * .85; g.lineWidth = lw * 1.4; body(); g.stroke();
                g.globalAlpha = a * .6; g.lineWidth = lw * .9; tail(); g.stroke();
                for (const s of [1, -1]) { fin(s)(); g.stroke(); }
                const e = eyes(1); g.globalAlpha = a; g.fillStyle = '#e8ecff'; g.beginPath(); g.arc(e[0], e[1], lw * 1.3, 0, TAU); g.fill();
                g.restore();
                return;
            }
            if (mask === 'plan') {
                // plan technique : traits fins, axe en tirets, couples, œil coté
                g.globalAlpha = a * .25; g.fillStyle = '#1d4fd6'; body(); g.fill();
                g.strokeStyle = '#dff6ff'; g.lineWidth = 1; g.globalAlpha = a * .95;
                body(); g.stroke(); tail(); g.stroke();
                for (const s of [1, -1]) { fin(s)(); g.stroke(); }
                g.globalAlpha = a * .55; g.setLineDash([5, 4]);
                g.beginPath(); g.moveTo(hd.x + hd.tx * f.w, hd.y + hd.ty * f.w); for (let i = 1; i < NODES; i++) g.lineTo(P[i].x, P[i].y); g.stroke();
                g.setLineDash([]); g.globalAlpha = a * .4;
                for (let i = 3; i < NODES - 1; i += 3) { g.beginPath(); g.moveTo(L[i].x, L[i].y); g.lineTo(R[i].x, R[i].y); g.stroke(); }
                const e = eyes(1); g.globalAlpha = a * .9; g.beginPath(); g.arc(e[0], e[1], lw * 2.2, 0, TAU); g.stroke();
                g.beginPath(); g.moveTo(e[0], e[1]); g.lineTo(e[0] + 16, e[1] - 16); g.lineTo(e[0] + 34, e[1] - 16); g.stroke();
                g.font = '10px ' + FONT; g.fillStyle = '#dff6ff'; g.fillText('Ø ' + (lw * 4.4).toFixed(1), e[0] + 18, e[1] - 19);
                // cote de longueur, parallèle au poisson
                const T = P[NODES - 1], off = f.w * 2.2, nx = -hd.ty, ny = hd.tx;
                const x1 = hd.x + nx * off, y1 = hd.y + ny * off, x2 = T.x + nx * off, y2 = T.y + ny * off;
                g.globalAlpha = a * .7; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
                for (const [x, y] of [[x1, y1], [x2, y2]]) { g.beginPath(); g.moveTo(x - nx * 5, y - ny * 5); g.lineTo(x + nx * 5, y + ny * 5); g.stroke(); }
                g.fillText('L = ' + Math.round(f.len) + ' mm', (x1 + x2) / 2 + nx * 6, (y1 + y2) / 2 + ny * 6);
                g.restore();
                return;
            }
            if (mask) {
                tail(); g.fillStyle = c2; g.globalAlpha = a; g.fill();
                for (const s of [1, -1]) { fin(s)(); g.fill(); }
                body(); g.fillStyle = c1; g.fill();
                g.fillStyle = over ? over.eye : '#ffffff';
                for (const s of [1, -1]) { const e = eyes(s); g.beginPath(); g.arc(e[0], e[1], Math.max(4.5, lw * 2.4), 0, TAU); g.fill(); }
                g.restore();
                return;
            }
            NG = g;
            g.globalCompositeOperation = 'lighter';
            g.lineJoin = g.lineCap = 'round';
            g.globalAlpha = a * .08; g.fillStyle = c1; g.translate(10, 18); body(); g.fill(); g.translate(-10, -18);
            tail(); g.fillStyle = c2; g.globalAlpha = a * .12; g.fill(); neon(tail, c2, lw * .9, a);
            for (const s of [1, -1]) { const fp = fin(s); fp(); g.fillStyle = c2; g.globalAlpha = a * .14; g.fill(); neon(fp, c2, lw * .8, a * .9); }
            body(); g.fillStyle = c1; g.globalAlpha = a * .13; g.fill(); neon(body, c1, lw, a);
            neon(() => { g.beginPath(); g.moveTo(P[2].x, P[2].y); for (let i = 3; i < NODES - 2; i++) g.lineTo(P[i].x, P[i].y); }, c2, lw * .7, a * .8);
            // photophores
            g.fillStyle = '#ffffff';
            for (let i = 4; i < NODES - 3; i += 2) {
                const p = P[i], w = width(f, p.u) * .55, k = .5 + .5 * Math.sin(S.t * 2 + i + f.phase * .1);
                for (const s of [1, -1]) { g.globalAlpha = a * .5 * k; g.beginPath(); g.arc(p.x - s * p.ty * w, p.y + s * p.tx * w, lw * .9, 0, TAU); g.fill(); }
            }
            for (const s of [1, -1]) {
                const e = eyes(s);
                g.globalAlpha = a; g.fillStyle = c2; g.beginPath(); g.arc(e[0], e[1], lw * 1.6, 0, TAU); g.fill();
                g.fillStyle = '#fff'; g.beginPath(); g.arc(e[0], e[1], lw * .7, 0, TAU); g.fill();
            }
            g.restore();
        }

        // ---------- visiteurs rares : requin, raie manta, tortue (vus de dessus) ----------
        // Chaque forme rend des tracés (corps, nageoires, détails) ; la manière de les peindre dépend du style
        function local(x0, y0, an) { const c = Math.cos(an), s = Math.sin(an); return (x, y) => [x0 + c * x - s * y, y0 + s * x + c * y]; }
        function shapePath(g, pts) {
            g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
            const z = pts[pts.length - 1]; g.lineTo(z[0], z[1]); g.closePath();
        }
        const VSHAPE = {
            requin(f, P, g) {
                const W = (u) => f.w * Math.pow(Math.sin(Math.PI * Math.min(1, u * .9 + .05)), .7) * (1.25 - u);
                const side = (s) => P.map((p) => [p.x - s * p.ty * W(p.u), p.y + s * p.tx * W(p.u)]);
                const L = side(1), R = side(-1), hd = P[0], T = P[NODES - 1], nose = [hd.x + hd.tx * f.w * 1.1, hd.y + hd.ty * f.w * 1.1];
                const body = () => shapePath(g, [nose, ...L.slice(0, -1), [T.x, T.y], ...R.slice(0, -1).reverse(), nose]);
                const fin = (i, s, out, back) => {
                    const p = P[i], q = P[i + 2], w = W(p.u), sway = Math.sin(f.phase * .6 + s) * .12;
                    const ox = p.x - s * p.ty * w, oy = p.y + s * p.tx * w;
                    const tx = ox - s * p.ty * f.w * out - p.tx * f.w * (back + sway), ty = oy + s * p.tx * f.w * out - p.ty * f.w * (back + sway);
                    return () => { g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo((ox + tx) / 2 + p.tx * f.w * .5, (oy + ty) / 2 + p.ty * f.w * .5, tx, ty); g.quadraticCurveTo(q.x - s * q.ty * W(q.u) * .6, q.y + s * q.tx * W(q.u) * .6, q.x - s * q.ty * W(q.u), q.y + s * q.tx * W(q.u)); g.closePath(); };
                };
                const ba = Math.atan2(-T.ty, -T.tx), sw = Math.sin(f.phase - 4.4) * .3, fl = f.len * .2;
                const tail = () => {
                    const up = [T.x + Math.cos(ba + .55 + sw) * fl, T.y + Math.sin(ba + .55 + sw) * fl], lo = [T.x + Math.cos(ba - .45 + sw) * fl * .7, T.y + Math.sin(ba - .45 + sw) * fl * .7];
                    const mid = [T.x + Math.cos(ba + sw) * fl * .35, T.y + Math.sin(ba + sw) * fl * .35];
                    g.beginPath(); g.moveTo(T.x, T.y); g.quadraticCurveTo(T.x + Math.cos(ba + .3 + sw) * fl * .5, T.y + Math.sin(ba + .3 + sw) * fl * .5, up[0], up[1]);
                    g.quadraticCurveTo(mid[0], mid[1], lo[0], lo[1]); g.quadraticCurveTo(T.x + Math.cos(ba - .2 + sw) * fl * .3, T.y + Math.sin(ba - .2 + sw) * fl * .3, T.x, T.y); g.closePath();
                };
                const dorsal = () => { const a = P[5], b = P[7], c = P[9]; g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(b.x - b.ty * f.w * .18, b.y + b.tx * f.w * .18, c.x, c.y); g.quadraticCurveTo(b.x + b.ty * f.w * .18, b.y - b.tx * f.w * .18, a.x, a.y); };
                const gills = () => { g.beginPath(); for (let i = 0; i < 4; i++) for (const s of [1, -1]) { const p = at(P, .16 + i * .025), w = W(p.u || .16) * .85; g.moveTo(p.x - s * p.ty * w * .5, p.y + s * p.tx * w * .5); g.lineTo(p.x - s * p.ty * w, p.y + s * p.tx * w); } };
                const eye = (s) => { const p = P[1], w = W(P[1].u) * .7; return [p.x - s * p.ty * w, p.y + s * p.tx * w]; };
                return { fins: [fin(3, 1, 2.6, 1.8), fin(3, -1, 2.6, 1.8), fin(9, 1, 1, .8), fin(9, -1, 1, .8), tail], body, ridge: [dorsal], lines: [gills], eyes: [eye(1), eye(-1)], er: .9 };
            },
            raie(f, P, g) {
                const c = P[2], an = Math.atan2(P[0].y - P[4].y, P[0].x - P[4].x), q = local(c.x, c.y, an), Lg = f.len * .55, flap = Math.sin(f.phase * .8);
                const span = Lg * (.95 + .12 * flap), back = Lg * (.12 - .1 * flap);
                const wing = (s) => [q(Lg * .28, s * Lg * .14), q(Lg * .12, s * span * .55), q(-back, s * span), q(-Lg * .2, s * span * .45), q(-Lg * .32, s * Lg * .1)];
                const body = () => { const a = wing(1), b = wing(-1).reverse(); shapePath(g, [q(Lg * .3, 0), ...a, q(-Lg * .36, 0), ...b, q(Lg * .3, 0)]); };
                const horn = (s) => () => { const a = q(Lg * .26, s * Lg * .06), b = q(Lg * .44, s * Lg * .13), e = q(Lg * .28, s * Lg * .16); g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo(b[0], b[1], e[0], e[1]); g.closePath(); };
                const tail = () => { g.beginPath(); const t0 = q(-Lg * .34, 0); g.moveTo(t0[0], t0[1]); for (let i = 5; i < NODES; i++) g.lineTo(P[i].x, P[i].y); };
                const spine2 = () => { const a = q(Lg * .2, 0), b = q(-Lg * .3, 0); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); for (const s of [1, -1]) { const m = q(-Lg * .05, s * span * .2), n = q(-back * .6, s * span * .7); g.moveTo(m[0], m[1]); g.lineTo(n[0], n[1]); } };
                return { fins: [horn(1), horn(-1)], body, ridge: [], lines: [spine2], strokes: [tail], eyes: [q(Lg * .24, Lg * .1), q(Lg * .24, -Lg * .1)], er: .8 };
            },
            tortue(f, P, g) {
                const c = P[3], an = Math.atan2(P[0].y - P[6].y, P[0].x - P[6].x), q = local(c.x, c.y, an), Lg = f.len * .5, st = Math.sin(f.phase * .9);
                const rx = Lg * .55, ry = Lg * .42;
                const shell = () => { g.beginPath(); const o = q(0, 0); g.ellipse(o[0], o[1], rx, ry, an, 0, TAU); };
                const head = () => { const h = q(rx + Lg * .17, 0); g.beginPath(); g.ellipse(h[0], h[1], Lg * .16, Lg * .12, an, 0, TAU); };
                const flipper = (s, big) => () => {
                    const r = big ? .6 + st * .45 : -.4 - st * .25, base = q(big ? rx * .45 : -rx * .62, s * ry * .78), len = Lg * (big ? .62 : .26);
                    const a2 = an + s * (big ? 1.2 + r * .5 : 2.3 + r * .4), tip = [base[0] + Math.cos(a2) * len, base[1] + Math.sin(a2) * len];
                    const w = len * (big ? .26 : .45), nx = -Math.sin(a2) * w, ny = Math.cos(a2) * w;
                    g.beginPath(); g.moveTo(base[0] + nx, base[1] + ny); g.quadraticCurveTo(tip[0] + nx * .6, tip[1] + ny * .6, tip[0], tip[1]); g.quadraticCurveTo((base[0] + tip[0]) / 2 - nx, (base[1] + tip[1]) / 2 - ny, base[0] - nx * .5, base[1] - ny * .5); g.closePath();
                };
                const scutes = () => {
                    g.beginPath();
                    const hex = (x, y, r) => { for (let i = 0; i <= 6; i++) { const p = q(x + Math.cos(i / 6 * TAU) * r, y + Math.sin(i / 6 * TAU) * r * .85); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } };
                    hex(0, 0, Lg * .16); hex(Lg * .3, 0, Lg * .12); hex(-Lg * .3, 0, Lg * .12);
                    for (const s of [1, -1]) for (const x of [-.22, .02, .26]) hex(Lg * x, s * Lg * .24, Lg * .1);
                };
                const eye = (s) => q(rx + Lg * .24, s * Lg * .06);
                return { fins: [flipper(1, true), flipper(-1, true), flipper(1, false), flipper(-1, false), head], body: shell, ridge: [], lines: [scutes], eyes: [eye(1), eye(-1)], er: .55 };
            },
        };
        function drawVisitor(f, vis, g, mask, over) {
            const P = spine(f), V = VISIT[f.kind], sh = VSHAPE[f.kind](f, P, g), hd = P[0];
            let a = vis * (.45 + .55 * f.depth);
            if (insideBox(hd.x, hd.y)) a *= .4;
            const lw = Math.max(1.2, f.w * .07), c1 = over ? over.c1 : f.robe[0], c2 = over ? over.c2 : f.robe[1];
            const fills = () => { for (const p of sh.fins) { p(); g.fill(); } };
            const strokeAll = () => { for (const p of [...sh.fins, sh.body]) { p(); g.stroke(); } };
            const extras = () => { for (const p of [...sh.ridge, ...sh.lines, ...(sh.strokes || [])]) { p(); g.stroke(); } };
            const er = Math.max(1.6, lw * sh.er * 1.6);
            g.save(); g.lineJoin = g.lineCap = 'round';
            if (mask === true) {
                // silhouette pleine pour les rendus en grille, l'œil en blanc
                g.globalAlpha = a; g.fillStyle = c2; fills(); g.fillStyle = c1; sh.body(); g.fill();
                g.strokeStyle = c2; g.lineWidth = lw * 2; for (const p of sh.strokes || []) { p(); g.stroke(); }
                g.fillStyle = over ? over.eye : '#ffffff';
                for (const e of sh.eyes) { g.beginPath(); g.arc(e[0], e[1], Math.max(4.5, er * 1.6), 0, TAU); g.fill(); }
            } else if (mask === false || mask === 'encre' || mask === 'plan') {
                // lumière : remplissage léger, contours au néon (ou trait clair pour l'encre et le plan)
                g.globalCompositeOperation = 'lighter';
                const line = mask ? (mask === 'plan' ? '#dff6ff' : '#e8ecff') : null;
                g.globalAlpha = a * (mask ? .18 : .1); g.fillStyle = mask === 'plan' ? '#1d4fd6' : c2; fills(); g.fillStyle = mask === 'plan' ? '#1d4fd6' : c1; sh.body(); g.fill();
                if (line) { g.strokeStyle = line; g.globalAlpha = a * .9; g.lineWidth = mask === 'plan' ? 1 : lw; strokeAll(); g.globalAlpha = a * .5; g.lineWidth = 1; extras(); }
                else {
                    NG = g;
                    for (const p of sh.fins) neon(p, c2, lw * .8, a * .9);
                    neon(sh.body, c1, lw, a);
                    for (const p of [...sh.ridge, ...sh.lines, ...(sh.strokes || [])]) neon(p, c2, lw * .5, a * .7);
                }
                g.fillStyle = line || '#ffffff'; g.globalAlpha = a;
                for (const e of sh.eyes) { g.beginPath(); g.arc(e[0], e[1], er, 0, TAU); g.fill(); }
            } else if (mask === 'calli') {
                // lavis d'encre sur le papier
                const c = INKC[V.ink];
                g.fillStyle = ink(c, .22 * a); fills(); g.fillStyle = ink(c, .32 * a); sh.body(); g.fill();
                g.strokeStyle = ink(INKC[2], .7 * a); g.lineWidth = lw * 1.1; strokeAll();
                g.strokeStyle = ink(INKC[2], .45 * a); g.lineWidth = lw * .7; extras();
                g.fillStyle = ink(INKC[2], .9 * a); for (const e of sh.eyes) { g.beginPath(); g.arc(e[0], e[1], er, 0, TAU); g.fill(); }
            } else {
                // styles peints : couleurs de la palette du style, contour sombre ou clair selon le fond
                const pal = PAL[mask] || PAL.ukiyo, dark = LIGHT.includes(mask) || mask === 'mosaique';
                const edge = dark ? pal[2] : pal[0];
                if (mask === 'abysses') g.globalCompositeOperation = 'lighter';
                g.globalAlpha = a * (mask === 'abysses' ? .35 : .92);
                g.fillStyle = pal[V.art[1]]; fills(); g.fillStyle = pal[V.art[0]]; sh.body(); g.fill();
                g.globalAlpha = a; g.strokeStyle = mask === 'or' ? pal[3] : edge; g.lineWidth = lw * (mask === 'vitrail' ? 2.2 : 1); strokeAll();
                g.globalAlpha = a * .55; g.strokeStyle = mask === 'or' ? pal[3] : V.art[0] === 2 ? pal[0] : edge; g.lineWidth = lw * .7; extras();
                g.globalAlpha = a; g.fillStyle = V.art[0] === 2 ? pal[0] : pal[2];
                for (const e of sh.eyes) { g.beginPath(); g.arc(e[0], e[1], er, 0, TAU); g.fill(); }
            }
            g.restore();
        }

        // ---------- rendus en grille : silhouettes réduites, lues case par case ----------
        const grid = { cw: 10, ch: 15, cols: 0, rows: 0, glyphs: null, drops: [] };
        const masks = { text: mkMask(), pixel: mkMask(), heat: mkMask(), mosa: mkMask() };
        function mkMask() { const c = document.createElement('canvas'); return { c, g: c.getContext('2d', { willReadFrequently: true }), cw: 1, ch: 1, data: null, at: -1 }; }
        function sizeGrids() {
            const small = S.W < 600;
            grid.cw = small ? 8 : 10; grid.ch = small ? 12 : 15;
            grid.cols = Math.ceil(S.W / grid.cw); grid.rows = Math.ceil(S.H / grid.ch);
            grid.glyphs = new Uint16Array(grid.cols * grid.rows).map(() => Math.random() * KATA.length | 0);
            grid.drops = Array.from({ length: grid.cols }, () => ({ y: rand(-grid.rows, grid.rows), v: rand(6, 16) }));
            const px = small ? 5 : 6;
            setMask(masks.text, grid.cw, grid.ch); setMask(masks.pixel, px, px); setMask(masks.heat, 8, 8);
        }
        function setMask(m, cw, ch) { m.cw = cw; m.ch = ch; m.cols = Math.ceil(S.W / cw); m.rows = Math.ceil(S.H / ch); m.c.width = m.cols; m.c.height = m.rows; m.at = -1; }
        function mask(m, vis) {
            if (m.at === S.frame) return m;
            m.g.setTransform(1, 0, 0, 1, 0, 0); m.g.clearRect(0, 0, m.cols, m.rows);
            m.g.setTransform(1 / m.cw, 0, 0, 1 / m.ch, 0, 0);
            const deco = opts.decor && m === masks.text && (S.style === 'ascii' || S.style === 'code' || S.prev === 'ascii' || S.prev === 'code');
            if (deco) decorMask(m.g, vis, true);
            for (const f of S.sorted) {
                // masque thermique : chaque poisson est peint en gris selon sa chaleur, l'œil plus chaud
                if (m === masks.heat) { const h = 70 + f.heat * 150 | 0, e = Math.min(255, h + 60); drawFish(f, 1, m.g, true, { c1: `rgb(${h},${h},${h})`, c2: `rgb(${h - 40},${h - 40},${h - 40})`, eye: `rgb(${e},${e},${e})` }); }
                else drawFish(f, deco ? vis * (1 - (f.z || 0) * .6) : vis, m.g, true);
            }
            if (deco) decorMask(m.g, vis, false);
            m.data = m.g.getImageData(0, 0, m.cols, m.rows).data;
            m.at = S.frame;
            return m;
        }

        // ---------- styles peints : estampe, trait d'or, aquarelle, papier découpé, vitrail, abysses, mosaïque ----------
        // Robes indexées comme INKC : 0 blanc, 1 rouge, 2 noir, 3 or
        const PAL = {
            ukiyo: ['#f3ead3', '#d2452a', '#202638', '#e3a83c'],
            or: ['#f2dc9a', '#e9b860', '#c79a45', '#f7e7b0'],
            aqua: ['#d8dde6', '#e2643c', '#3a3e4a', '#e6a640'],
            papier: ['#f6f1e6', '#e0502f', '#2a2a33', '#f0b23c'],
            vitrail: ['#f4efe0', '#e0442a', '#2b2f45', '#f2b630'],
            abysses: ['#7ff6ff', '#3dffb0', '#b26bff', '#ffd166'],
            mosaique: ['#f2ede2', '#d9462b', '#2a2c36', '#e8a93a'],
        };
        const LIGHT = ['calli', 'ukiyo', 'aqua', 'papier'];
        const art = new Map();
        const spineAng = (c) => Math.atan2(c.ty, c.tx) + Math.PI;
        // taches de la robe, posées le long de l'épine (u) et en travers (v, en largeurs)
        function robePatches(G, pal, each) {
            const { f, g, P } = G;
            for (const p of f.koi.patches) {
                const c = at(P, p.u), w = width(f, p.u), x = c.x - c.ty * w * p.v, y = c.y + c.tx * w * p.v;
                g.beginPath(); g.ellipse(x, y, Math.max(2, p.ru * f.len), Math.max(2, p.rv * w), spineAng(c), 0, TAU);
                if (each) each(p, x, y); else { g.fillStyle = pal[p.c]; g.fill(); }
            }
        }
        // couleur dominante d'un tronçon du corps (pour le vitrail)
        function robeAt(f, u, pal) {
            for (const p of f.koi.patches) if (Math.abs(p.u - u) < p.ru * 1.2) return pal[p.c];
            return pal[f.koi.base];
        }
        function finRays(G, col, lw, al) {
            const { g, T, ba, sw, fl, fin, f } = G;
            g.strokeStyle = col; g.lineWidth = lw; g.globalAlpha = al;
            g.beginPath();
            for (let k = -1; k <= 1.001; k += .25) { const an = ba + k * .5 + sw; g.moveTo(T.x, T.y); g.lineTo(T.x + Math.cos(an) * fl * .92, T.y + Math.sin(an) * fl * .92); }
            for (const s of [1, -1]) { const fp = fin(s); for (let k = -.4; k <= .41; k += .2) { const an = fp.an + k; g.moveTo(fp.ox, fp.oy); g.lineTo(fp.ox + Math.cos(an) * f.w * 1.8, fp.oy + Math.sin(an) * f.w * 1.8); } }
            g.stroke();
        }
        // écailles en demi-cercles tournés vers la queue
        function scales(G, col, al, lw) {
            const { f, g, P } = G;
            g.strokeStyle = col; g.globalAlpha = al; g.lineWidth = lw; g.beginPath();
            const r = f.w * .2;
            for (let u = .22; u < .86; u += .07) {
                const c = at(P, u), w = width(f, u), an = spineAng(c);
                for (let v = -.7; v <= .71; v += .35) {
                    const x = c.x - c.ty * w * v, y = c.y + c.tx * w * v;
                    g.moveTo(x + Math.cos(an - Math.PI / 2) * r, y + Math.sin(an - Math.PI / 2) * r);
                    g.arc(x, y, r, an - Math.PI / 2, an + Math.PI / 2);
                }
            }
            g.stroke();
        }
        function artEye(G, r, white, pupil) {
            const { g, eyes, a } = G; g.globalAlpha = a;
            for (const s of [1, -1]) { const e = eyes(s); if (white) { g.fillStyle = white; g.beginPath(); g.arc(e[0], e[1], r * 1.6, 0, TAU); g.fill(); } g.fillStyle = pupil; g.beginPath(); g.arc(e[0], e[1], r, 0, TAU); g.fill(); }
        }

        const ART = {
            // Estampe ukiyo-e : aplats, contour indigo épais, écailles et rayons gravés
            ukiyo(G) {
                const { f, g, a, body, tail, fin, lw } = G, pal = PAL.ukiyo, K = f.koi, ink = pal[2];
                g.lineJoin = g.lineCap = 'round'; g.globalAlpha = a;
                const finC = K.base === 2 ? '#3a4058' : 'rgba(243,234,211,.92)';
                tail(); g.fillStyle = finC; g.fill();
                for (const s of [1, -1]) { fin(s)(); g.fill(); }
                finRays(G, ink, .9, a * .55);
                g.globalAlpha = a; g.strokeStyle = ink; g.lineWidth = lw * 1.2; tail(); g.stroke();
                for (const s of [1, -1]) { fin(s)(); g.stroke(); }
                body(); g.fillStyle = pal[K.base]; g.fill();
                g.save(); body(); g.clip(); robePatches(G, pal);
                scales(G, K.base === 2 ? '#8a90a8' : ink, a * .35, .8);
                g.restore();
                g.globalAlpha = a; g.strokeStyle = ink; g.lineWidth = lw * 1.8; body(); g.stroke();
                artEye(G, lw * 1.1, '#f3ead3', ink);
            },
            // Trait d'or sur bleu nuit : un seul fil doré, écailles fines et un reflet qui glisse
            or(G) {
                const { f, g, a, P, body, tail, fin, lw, hd, T } = G, pal = PAL.or;
                const gr = g.createLinearGradient(hd.x, hd.y, T.x, T.y);
                gr.addColorStop(0, '#fff1c4'); gr.addColorStop(.45, '#d8a64a'); gr.addColorStop(1, '#f5d98a');
                g.lineJoin = g.lineCap = 'round';
                g.globalAlpha = a * .9; g.fillStyle = '#0a1230'; body(); g.fill();
                g.save(); body(); g.clip(); robePatches(G, pal, (p) => { g.globalAlpha = a * (p.c === 2 ? .08 : .2); g.fillStyle = pal[p.c]; g.fill(); }); scales(G, '#d8a64a', a * .45, .6); g.restore();
                g.strokeStyle = gr; g.globalAlpha = a * .8; g.lineWidth = .7;
                for (const s of [1, -1]) { fin(s)(); g.stroke(); }
                tail(); g.stroke();
                finRays(G, gr, .5, a * .55);
                g.globalAlpha = a; g.strokeStyle = gr; g.lineWidth = Math.max(1.2, lw * .9); body(); g.stroke();
                g.globalAlpha = a * .6; g.lineWidth = .7; along(g, f, P, .12, .82, 0); g.stroke();
                const k = (S.t * .35 + (f.pid || 0) * .13) % 1.4;
                if (k < 1) {
                    const c = at(P, k), rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, f.w * 1.2);
                    rg.addColorStop(0, 'rgba(255,240,190,.55)'); rg.addColorStop(1, 'rgba(255,240,190,0)');
                    g.globalCompositeOperation = 'lighter'; g.globalAlpha = a * Math.sin(k * Math.PI); g.fillStyle = rg;
                    g.fillRect(c.x - f.w * 1.2, c.y - f.w * 1.2, f.w * 2.4, f.w * 2.4); g.globalCompositeOperation = 'source-over';
                }
                artEye(G, lw * .9, null, '#fff1c4');
            },
            // Aquarelle : lavis transparents qui se superposent, bord plus foncé, pigment qui fleurit
            aqua(G) {
                const { f, g, a, body, tail, fin, lw } = G, pal = PAL.aqua, K = f.koi, j = f.aq || (f.aq = Array.from({ length: 6 }, () => [rand(-2.5, 2.5), rand(-2.5, 2.5)]));
                g.lineJoin = g.lineCap = 'round';
                g.fillStyle = K.base === 2 ? pal[2] : '#9fb3c8';
                for (let i = 0; i < 2; i++) { g.save(); g.translate(j[i][0], j[i][1]); g.globalAlpha = a * .16; tail(); g.fill(); for (const s of [1, -1]) { fin(s)(); g.fill(); } g.restore(); }
                for (let i = 0; i < 2; i++) { g.save(); g.translate(j[i + 2][0] * .6, j[i + 2][1] * .6); g.globalAlpha = a * (K.base === 0 ? .32 : .42); g.fillStyle = pal[K.base]; body(); g.fill(); g.restore(); }
                g.save(); body(); g.clip();
                robePatches(G, pal, (p, x, y) => {
                    g.globalAlpha = a * .5; g.fillStyle = pal[p.c]; g.fill();
                    g.globalAlpha = a * .35; g.strokeStyle = pal[p.c]; g.lineWidth = 2; g.stroke();
                });
                g.restore();
                g.globalAlpha = a * .4; g.strokeStyle = K.base === 2 ? pal[2] : '#6d7f96'; g.lineWidth = 1.4; body(); g.stroke();
                g.globalAlpha = a * .3; g.lineWidth = .8; tail(); g.stroke();
                artEye(G, lw * .9, null, '#2b2f3a');
            },
            // Papier découpé : pièces plates avec ombre portée
            papier(G) {
                const { f, g, a, body, tail, fin, lw } = G, pal = PAL.papier, K = f.koi, z = f.z || 0;
                g.globalAlpha = a; g.lineJoin = 'round';
                g.shadowColor = 'rgba(20,30,60,.35)'; g.shadowBlur = 8 + z * 6; g.shadowOffsetX = 3 + z * 5; g.shadowOffsetY = 5 + z * 7;
                g.fillStyle = K.base === 2 ? '#4a4c5a' : '#f1e3c8';
                tail(); g.fill(); for (const s of [1, -1]) { fin(s)(); g.fill(); }
                g.fillStyle = pal[K.base]; body(); g.fill();
                g.shadowBlur = 3; g.shadowOffsetX = 1; g.shadowOffsetY = 2; g.shadowColor = 'rgba(20,30,60,.3)';
                g.save(); body(); g.clip(); robePatches(G, pal); g.restore();
                g.shadowColor = 'transparent';
                g.globalAlpha = a * .25; g.strokeStyle = '#fff'; g.lineWidth = 1; body(); g.stroke();
                artEye(G, lw * 1.1, '#fff', '#1d1d24');
            },
            // Vitrail : le corps est coupé en pièces de verre serties de plomb
            vitrail(G) {
                const { f, g, a, L, R, P, tail, fin, lw, hd } = G, pal = PAL.vitrail;
                g.lineJoin = 'round'; g.globalAlpha = a;
                const lead = '#17161c', cuts = [0, 3, 6, 9, 12, NODES - 1];
                const glass = (path, col, cx, cy, r) => {
                    path(); const rg = g.createRadialGradient(cx - r * .3, cy - r * .3, 0, cx, cy, r * 1.2);
                    rg.addColorStop(0, '#fffaf0'); rg.addColorStop(.25, col); rg.addColorStop(1, col);
                    g.globalAlpha = a * .92; g.fillStyle = rg; g.fill();
                    g.globalAlpha = a; g.strokeStyle = lead; g.lineWidth = Math.max(2, lw * 1.5); g.stroke();
                };
                const finCol = f.koi.base === 2 ? '#5c6a9e' : '#f4c96b';
                glass(tail, finCol, G.T.x, G.T.y, G.fl);
                for (const s of [1, -1]) { const fp = fin(s); glass(fp, finCol, fp.ox, fp.oy, f.w * 1.6); }
                for (let k = 0; k < cuts.length - 1; k++) {
                    const i0 = cuts[k], i1 = cuts[k + 1], path = () => {
                        g.beginPath();
                        if (k === 0) { g.moveTo(hd.x + hd.tx * f.w * .55, hd.y + hd.ty * f.w * .55); g.quadraticCurveTo(L[0].x + hd.tx * f.w * .4, L[0].y + hd.ty * f.w * .4, L[1].x, L[1].y); }
                        else g.moveTo(L[i0].x, L[i0].y);
                        for (let i = Math.max(i0, 1); i <= i1; i++) g.lineTo(L[i].x, L[i].y);
                        for (let i = i1; i >= Math.max(i0, 1); i--) g.lineTo(R[i].x, R[i].y);
                        if (k === 0) g.quadraticCurveTo(R[0].x + hd.tx * f.w * .4, R[0].y + hd.ty * f.w * .4, hd.x + hd.tx * f.w * .55, hd.y + hd.ty * f.w * .55);
                        g.closePath();
                    };
                    const m = P[(i0 + i1) >> 1];
                    glass(path, robeAt(f, (i0 + i1) / 2 / (NODES - 1), pal), m.x, m.y, f.w * 1.3);
                }
                g.globalAlpha = a; g.strokeStyle = lead; g.lineWidth = Math.max(1.5, lw);
                g.beginPath(); g.moveTo(P[1].x, P[1].y); for (let i = 2; i < NODES - 1; i++) g.lineTo(P[i].x, P[i].y); g.stroke();
                artEye(G, lw * 1.2, lead, '#9fe8ff');
            },
            // Abysses : silhouettes sombres et photophores qui pulsent en vague
            abysses(G) {
                const { f, g, a, P, body, tail, fin, lw } = G, pal = PAL.abysses, K = f.koi, col = pal[K.base];
                g.lineJoin = g.lineCap = 'round';
                g.globalAlpha = a * .92; g.fillStyle = '#040915'; tail(); g.fill(); for (const s of [1, -1]) { fin(s)(); g.fill(); } body(); g.fill();
                g.globalCompositeOperation = 'lighter';
                g.globalAlpha = a * .22; g.strokeStyle = col; g.lineWidth = 1; body(); g.stroke(); tail(); g.stroke();
                g.save(); body(); g.clip();
                robePatches(G, pal, (p, x, y) => {
                    const r = Math.max(p.ru * f.len, p.rv * width(f, p.u)) * 1.2, rg = g.createRadialGradient(x, y, 0, x, y, r);
                    rg.addColorStop(0, pal[p.c]); rg.addColorStop(1, 'rgba(0,0,0,0)');
                    g.globalAlpha = a * .4 * (.6 + .4 * Math.sin(S.t * 1.7 + p.u * 8)); g.fillStyle = rg; g.fill();
                });
                g.restore();
                g.fillStyle = col;
                for (let i = 2; i < NODES - 2; i++) {
                    const p = P[i], w = width(f, p.u) * .62, k = Math.pow(.5 + .5 * Math.sin(S.t * 3.2 - p.u * 9 + (f.pid || 0)), 3);
                    for (const s of [1, -1]) {
                        const x = p.x - s * p.ty * w, y = p.y + s * p.tx * w;
                        g.globalAlpha = a * (.12 + .3 * k); g.beginPath(); g.arc(x, y, lw * 1.7, 0, TAU); g.fill();
                        g.globalAlpha = a * (.4 + .6 * k); g.beginPath(); g.arc(x, y, lw * .55, 0, TAU); g.fill();
                    }
                }
                g.globalCompositeOperation = 'source-over';
                artEye(G, lw * .9, null, '#eaffff');
            },
            // masque plat pour la mosaïque
            mosaique(G) {
                const { f, g, a, body, tail, fin } = G, pal = PAL.mosaique, K = f.koi;
                g.globalAlpha = 1; g.fillStyle = K.base === 2 ? '#4b4e5c' : '#efe2c8';
                tail(); g.fill(); for (const s of [1, -1]) { fin(s)(); g.fill(); }
                g.fillStyle = pal[K.base]; body(); g.fill();
                g.save(); body(); g.clip(); robePatches(G, pal); g.restore();
                g.fillStyle = '#ffffff'; for (const s of [1, -1]) { const e = G.eyes(s); g.fillRect(e[0] - 3, e[1] - 3, 6, 6); }
            },
        };

        // ---------- décors des styles peints (peints une fois par taille d'écran) ----------
        function canvasFull() { const c = document.createElement('canvas'); c.width = Math.round(S.W * S.dpr); c.height = Math.round(S.H * S.dpr); const q = c.getContext('2d'); q.scale(S.dpr, S.dpr); return [c, q]; }
        function fibers(q, W, H, dark, light, n) {
            for (let i = 0; i < W * H / n; i++) {
                const x = Math.random() * W, y = Math.random() * H, an = Math.random() * TAU, l = rand(3, 16);
                q.strokeStyle = Math.random() < .5 ? dark : light; q.lineWidth = rand(.4, 1);
                q.beginPath(); q.moveTo(x, y); q.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); q.stroke();
            }
        }
        function padShape(q, pd) {
            const { r, notch, edge } = pd;
            q.beginPath(); q.moveTo(0, 0);
            for (let i = 0; i <= 27; i++) { const an = notch + .22 + i / 27 * (TAU - .44); q.lineTo(Math.cos(an) * r * edge[i], Math.sin(an) * r * edge[i]); }
            q.closePath();
        }
        function lotus(q, r, petal, line, heart) {
            for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 7; i++) {
                const an = i / 7 * TAU + ring * .45, l = r * (ring ? .38 : .55);
                q.save(); q.translate(Math.cos(an) * l * .35, Math.sin(an) * l * .35); q.rotate(an + Math.PI / 2);
                q.fillStyle = petal[ring]; q.strokeStyle = line; q.lineWidth = .8;
                q.beginPath(); q.ellipse(0, 0, l * .28, l * .5, 0, 0, TAU); q.fill(); if (line) q.stroke(); q.restore();
            }
            q.fillStyle = heart; q.beginPath(); q.arc(0, 0, r * .12, 0, TAU); q.fill();
        }
        // un nénuphar par style, peint dans sa propre image pour dériver
        function stylePads(style) {
            const d = S.dpr;
            return padSprites.ink.map((pd, k) => {
                const R2 = pd.r * 1.2 + 18, c = document.createElement('canvas'); c.width = c.height = Math.ceil(R2 * 2 * d);
                const q = c.getContext('2d'); q.scale(d, d); q.translate(R2, R2); q.lineJoin = q.lineCap = 'round';
                const veins = (col, lw) => { q.strokeStyle = col; q.lineWidth = lw; q.beginPath(); for (let v = 0; v < 6; v++) { const an = pd.notch + .5 + v * (TAU - 1) / 5; q.moveTo(0, 0); q.lineTo(Math.cos(an) * pd.r * .85, Math.sin(an) * pd.r * .85); } q.stroke(); };
                if (style === 'ukiyo') {
                    padShape(q, pd); q.fillStyle = '#6d9a62'; q.fill(); q.strokeStyle = '#202638'; q.lineWidth = 2; q.stroke(); veins('rgba(32,38,56,.45)', 1);
                    if (!k) lotus(q, pd.r, ['#e88aa0', '#f4b8c4'], '#202638', '#e3a83c');
                } else if (style === 'or') {
                    padShape(q, pd); q.fillStyle = 'rgba(10,18,48,.9)'; q.fill(); q.strokeStyle = '#d8a64a'; q.lineWidth = 1.2; q.stroke(); veins('rgba(216,166,74,.45)', .7);
                    if (!k) lotus(q, pd.r, ['rgba(10,18,48,.9)', 'rgba(10,18,48,.9)'], '#f2d27a', '#f7e7b0');
                } else if (style === 'aqua') {
                    for (let i = 0; i < 3; i++) { q.save(); q.translate(rand(-2, 2), rand(-2, 2)); padShape(q, pd); q.fillStyle = 'rgba(110,160,110,.22)'; q.fill(); q.restore(); }
                    padShape(q, pd); q.strokeStyle = 'rgba(70,120,80,.35)'; q.lineWidth = 1.6; q.stroke(); veins('rgba(70,120,80,.2)', 1);
                    if (!k) { q.globalAlpha = .75; lotus(q, pd.r, ['rgba(232,120,150,.6)', 'rgba(246,170,190,.6)'], null, 'rgba(230,180,60,.8)'); }
                } else if (style === 'papier') {
                    q.shadowColor = 'rgba(20,30,60,.35)'; q.shadowBlur = 8; q.shadowOffsetX = 3; q.shadowOffsetY = 5;
                    padShape(q, pd); q.fillStyle = '#5f9e5a'; q.fill();
                    q.shadowColor = 'transparent'; q.save(); q.scale(.72, .72); padShape(q, pd); q.fillStyle = '#79b56e'; q.fill(); q.restore();
                    if (!k) { q.shadowColor = 'rgba(20,30,60,.35)'; q.shadowBlur = 4; q.shadowOffsetY = 2; lotus(q, pd.r, ['#e8708f', '#f5a3b6'], null, '#f0b23c'); }
                } else if (style === 'vitrail') {
                    padShape(q, pd); const rg = q.createRadialGradient(-pd.r * .3, -pd.r * .3, 0, 0, 0, pd.r); rg.addColorStop(0, '#d8f5b0'); rg.addColorStop(.4, '#4f9a45'); rg.addColorStop(1, '#2f6a33');
                    q.fillStyle = rg; q.fill(); q.strokeStyle = '#17161c'; q.lineWidth = 4; q.stroke(); veins('#17161c', 2.5);
                    if (!k) lotus(q, pd.r, ['#c0306a', '#ef7fae'], '#17161c', '#f2b630');
                } else if (style === 'abysses') {
                    q.globalCompositeOperation = 'lighter';
                    padShape(q, pd); q.fillStyle = 'rgba(20,60,80,.18)'; q.fill(); q.strokeStyle = 'rgba(61,255,176,.35)'; q.lineWidth = 1; q.stroke(); veins('rgba(61,255,176,.15)', .7);
                }
                return { c, R2, x: pd.x, y: pd.y, ph: pd.ph };
            });
        }
        function driftPads(g, list) {
            for (const pd of list) {
                const t = S.t * .06 + pd.ph, x = pd.x + Math.sin(t) * 7 + Math.sin(t * 2.3) * 2, y = pd.y + Math.cos(t * .8) * 5, rot = Math.sin(t * .7) * .05;
                g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(pd.c, -pd.R2, -pd.R2, pd.R2 * 2, pd.R2 * 2); g.restore();
            }
        }
        function artBg(style) {
            const W = S.W, H = S.H, small = W < 640, [c, q] = canvasFull();
            const sx = small ? W * .34 : W * .2, sy = small ? H * .2 : H * .27, R = clamp(Math.min(W, H) * .13, 50, 130);
            if (style === 'ukiyo') {
                // bokashi : bleu de Prusse en haut qui s'éclaircit, vagues gravées, marge de papier
                const gr = q.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#1d3a66'); gr.addColorStop(.42, '#9fbfc4'); gr.addColorStop(1, '#c9d7cc');
                q.fillStyle = gr; q.fillRect(0, 0, W, H);
                q.lineCap = 'round';
                for (let y = 40, row = 0; y < H; y += 54, row++) {
                    const off = row % 2 ? 40 : 0, deep = y < H * .4;
                    q.strokeStyle = deep ? 'rgba(220,235,240,.5)' : 'rgba(29,58,102,.32)'; q.lineWidth = 1.6;
                    for (let x = -80 + off; x < W + 80; x += 80) {
                        q.beginPath(); q.moveTo(x, y); q.bezierCurveTo(x + 20, y - 14, x + 44, y - 14, x + 52, y - 2);
                        q.arc(x + 46, y - 2, 6, 0, Math.PI * 1.5, true); q.stroke();
                        q.fillStyle = deep ? 'rgba(240,248,250,.7)' : 'rgba(255,255,255,.55)';
                        for (let k = 0; k < 3; k++) { q.beginPath(); q.arc(x + 14 + k * 9, y - 12 - (k % 2) * 2, 1.4, 0, TAU); q.fill(); }
                    }
                }
                fibers(q, W, H, 'rgba(60,50,30,.06)', 'rgba(255,255,255,.12)', 700);
                // soleil levant plat
                q.fillStyle = '#d2452a'; q.beginPath(); q.arc(sx, sy, R * .8, 0, TAU); q.fill();
                // cartouche du titre et sceau
                const fs = small ? 18 : 24, cw = fs * 1.7, ch = fs * 4.6, cx = W - (small ? 24 : 40) - cw, cy = small ? H * .34 : H * .38;
                q.fillStyle = '#f3ead3'; q.fillRect(cx, cy, cw, ch); q.strokeStyle = '#202638'; q.lineWidth = 2; q.strokeRect(cx, cy, cw, ch); q.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8);
                q.fillStyle = '#202638'; q.font = `${fs}px ${SERIF}`; q.textAlign = 'center'; q.textBaseline = 'middle';
                [...'池の鯉'].forEach((t, i) => q.fillText(t, cx + cw / 2, cy + fs * 1.05 + i * fs * 1.15));
                q.fillStyle = '#d2452a'; q.fillRect(cx + cw * .2, cy + ch + 10, cw * .6, cw * .6);
                q.fillStyle = '#f3ead3'; q.font = `600 ${cw * .4}px ${SERIF}`; q.fillText('シ', cx + cw / 2, cy + ch + 10 + cw * .3 + 1);
                q.strokeStyle = '#202638'; q.lineWidth = 3; q.strokeRect(6, 6, W - 12, H - 12);
            } else if (style === 'or') {
                const gr = q.createRadialGradient(W * .6, H * .3, 0, W * .5, H * .5, Math.max(W, H) * .8);
                gr.addColorStop(0, '#12205a'); gr.addColorStop(1, '#060b22'); q.fillStyle = gr; q.fillRect(0, 0, W, H);
                // seigaiha (vagues en écailles) très discrètes
                q.strokeStyle = 'rgba(216,166,74,.07)'; q.lineWidth = 1;
                for (let y = 0, row = 0; y < H + 40; y += 18, row++) for (let x = (row % 2) * 22; x < W + 44; x += 44) for (let r = 22; r > 4; r -= 6) { q.beginPath(); q.arc(x, y, r, Math.PI, TAU); q.stroke(); }
                for (let i = 0; i < W * H / 2500; i++) { q.fillStyle = `rgba(240,210,140,${rand(.1, .6)})`; q.beginPath(); q.arc(Math.random() * W, Math.random() * H, rand(.3, 1.2), 0, TAU); q.fill(); }
                // lune en ensō doré
                q.strokeStyle = '#d8a64a'; q.lineCap = 'round';
                for (let i = 0; i < 40; i++) { const t = i / 40; q.lineWidth = 1 + 4 * Math.sin(Math.PI * t); q.globalAlpha = .85; q.beginPath(); q.arc(sx, sy, R, -1.2 + t * 5.6, -1.2 + (t + .03) * 5.6); q.stroke(); }
                q.globalAlpha = 1;
            } else if (style === 'aqua') {
                q.fillStyle = '#fbf8f1'; q.fillRect(0, 0, W, H);
                const wash = (x, y, r, col, al) => {
                    const n = 14, ph = rand(0, TAU), pts = Array.from({ length: n }, (_, i) => { const an = i / n * TAU, rr = r * (1 + Math.sin(an * 3 + ph) * .12 + rand(-.06, .06)); return [x + Math.cos(an) * rr, y + Math.sin(an) * rr * .8]; });
                    const path = () => { q.beginPath(); for (let i = 0; i <= n; i++) { const A = pts[i % n], B = pts[(i + 1) % n], mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2; i ? q.quadraticCurveTo(A[0], A[1], mx, my) : q.moveTo(mx, my); } q.closePath(); };
                    q.save(); q.filter = 'blur(6px)'; path(); q.fillStyle = `rgba(${col},${al})`; q.fill(); q.restore();
                    q.save(); q.filter = 'blur(1.2px)'; path(); q.strokeStyle = `rgba(${col},${al * 1.5})`; q.lineWidth = 2.5; q.stroke(); q.restore();
                };
                for (let i = 0; i < 9; i++) wash(rand(0, W), rand(H * .2, H), rand(160, 380), Math.random() < .6 ? '120,170,200' : '120,190,175', .09);
                for (let i = 0; i < 5; i++) wash(rand(0, W), rand(0, H), rand(60, 160), '150,190,215', .07);
                for (let i = 0; i < W * H / 60; i++) { q.fillStyle = `rgba(70,100,130,${rand(.02, .08)})`; q.fillRect(Math.random() * W, Math.random() * H, 1, 1); }
                fibers(q, W, H, 'rgba(120,100,70,.04)', 'rgba(255,255,255,.3)', 900);
                q.globalAlpha = .55; wash(sx, sy, R * .85, '230,110,70', .5); q.globalAlpha = 1;
            } else if (style === 'papier') {
                // couches de papier ondulées, de la plus claire à la plus foncée
                q.fillStyle = '#d9ecef'; q.fillRect(0, 0, W, H);
                q.fillStyle = '#f4c56a'; q.beginPath(); q.arc(sx, sy, R * .75, 0, TAU); q.fill();
                const cols = ['#bfe0e6', '#9fcfda', '#7dbacb', '#5ea2b9', '#46889f', '#356f86'];
                cols.forEach((col, i) => {
                    const y0 = H * (.12 + i * .15), amp = rand(10, 22), fr = rand(.004, .009), ph = rand(0, TAU);
                    q.save(); q.shadowColor = 'rgba(20,40,60,.35)'; q.shadowBlur = 14; q.shadowOffsetY = -3;
                    q.beginPath(); q.moveTo(0, H); q.lineTo(0, y0);
                    for (let x = 0; x <= W + 10; x += 10) q.lineTo(x, y0 + Math.sin(x * fr + ph) * amp + Math.sin(x * fr * 2.7 + ph) * amp * .3);
                    q.lineTo(W, H); q.closePath(); q.fillStyle = col; q.fill(); q.restore();
                });
                fibers(q, W, H, 'rgba(0,0,0,.035)', 'rgba(255,255,255,.12)', 500);
            } else if (style === 'vitrail') {
                q.fillStyle = '#17161c'; q.fillRect(0, 0, W, H);
                const s = small ? 80 : 110, cols = Math.ceil(W / s) + 2, rows = Math.ceil(H / s) + 2, pts = [];
                for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push([(i - .5) * s + rand(-.28, .28) * s, (j - .5) * s + rand(-.28, .28) * s]);
                const P = (i, j) => pts[j * cols + i], BLUES = ['#173d6b', '#1d4f80', '#143f57', '#1c5a6e', '#22477f', '#174f5c', '#2a5785', '#1a3a70'];
                const tri = (A, B, C) => {
                    q.beginPath(); q.moveTo(A[0], A[1]); q.lineTo(B[0], B[1]); q.lineTo(C[0], C[1]); q.closePath();
                    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, sun = Math.hypot(cx - sx, cy - sy) < R;
                    const col = sun ? (Math.random() < .5 ? '#f2b630' : '#e98a2a') : BLUES[Math.random() * BLUES.length | 0];
                    const rg = q.createRadialGradient(cx - s * .2, cy - s * .2, 0, cx, cy, s * .7);
                    rg.addColorStop(0, sun ? '#fff2c0' : 'rgba(150,200,230,.55)'); rg.addColorStop(.3, col); rg.addColorStop(1, col);
                    q.fillStyle = rg; q.fill(); q.strokeStyle = '#17161c'; q.lineWidth = 3; q.stroke();
                };
                for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
                    const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), dd = P(i, j + 1);
                    if ((i + j) % 2) { tri(a, b, cc); tri(a, cc, dd); } else { tri(a, b, dd); tri(b, cc, dd); }
                }
                const lg = q.createLinearGradient(0, 0, W, H); lg.addColorStop(0, 'rgba(255,240,200,.18)'); lg.addColorStop(1, 'rgba(0,0,20,.25)');
                q.fillStyle = lg; q.fillRect(0, 0, W, H);
            } else if (style === 'abysses') {
                const gr = q.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#062038'); gr.addColorStop(.5, '#020a18'); gr.addColorStop(1, '#01030a');
                q.fillStyle = gr; q.fillRect(0, 0, W, H);
                q.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 5; i++) {
                    const x = rand(0, W), w = rand(40, 140), sk = rand(-.3, .3) * H, lg = q.createLinearGradient(0, 0, 0, H * .8);
                    lg.addColorStop(0, 'rgba(90,170,220,.07)'); lg.addColorStop(1, 'rgba(90,170,220,0)');
                    q.fillStyle = lg; q.beginPath(); q.moveTo(x, 0); q.lineTo(x + w, 0); q.lineTo(x + w + sk, H * .8); q.lineTo(x + sk, H * .8); q.closePath(); q.fill();
                }
            } else if (style === 'mosaique') {
                const m = masks.mosa, t = m.cw;
                q.fillStyle = '#9d9584'; q.fillRect(0, 0, W, H);
                for (let r = 0; r < m.rows; r++) for (let cI = 0; cI < m.cols; cI++) {
                    const x = cI * t, y = r * t, v = Math.sin(x * .018 + Math.sin(y * .045) * 1.6) * .5 + .5, sun = Math.hypot(x - sx, y - sy) < R * .8;
                    const base = sun ? [222, 112, 52] : v > .93 ? [150, 196, 214] : v > .55 ? [46, 104, 150] : [32, 78, 128];
                    tile(q, x, y, t, base, cI * 7919 + r * 104729);
                }
            }
            return c;
        }
        // une tesselle : couleur légèrement variée, joint clair et biseau
        function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }
        function tile(q, x, y, t, c, seed) {
            const j = (hash(seed) - .5) * 26, gap = 1.3, sh = (hash(seed + 1) - .5) * 1.2;
            q.fillStyle = `rgb(${clamp(c[0] + j, 0, 255) | 0},${clamp(c[1] + j, 0, 255) | 0},${clamp(c[2] + j, 0, 255) | 0})`;
            q.fillRect(x + gap + sh, y + gap - sh, t - gap * 2, t - gap * 2);
            q.fillStyle = 'rgba(255,255,255,.18)'; q.fillRect(x + gap + sh, y + gap - sh, t - gap * 2, 1.2);
        }
        function artScene(style) {
            const key = style + ':' + S.W + 'x' + S.H + ':' + S.dpr;
            let sc = art.get(style);
            if (!sc || sc.key !== key) {
                ensureScene();
                if (style === 'mosaique') { const t = S.W < 600 ? 9 : 12; if (masks.mosa.cw !== t || masks.mosa.cols !== Math.ceil(S.W / t)) setMask(masks.mosa, t, t); }
                sc = { key, bg: artBg(style), pads: style === 'mosaique' ? [] : stylePads(style) };
                art.set(style, sc);
            }
            return sc;
        }
        // nourriture et ronds dans l'eau, dans la couleur du style
        // granulés : petites billes ovales qui flottent, avec un reflet, une ombre ou un halo selon le fond
        const PELLET = {
            nuit: { c: ['#ffb453', '#ff8a3d', '#ffd27a'], edge: 'rgba(120,50,10,.6)', glow: '#ffb453' },
            calli: { c: ['#8a4a22', '#a85a2a', '#6e3a1c'], edge: 'rgba(22,19,18,.7)', shadow: 'rgba(22,19,18,.2)' },
            ukiyo: { c: ['#a8582a', '#c27034', '#8c4a22'], edge: '#202638', shadow: 'rgba(32,38,56,.25)' },
            aqua: { c: ['#b8693a', '#cf8247', '#9c5530'], edge: 'rgba(58,62,74,.5)', shadow: 'rgba(58,62,74,.18)' },
            papier: { c: ['#c8642c', '#e08a3c', '#a9502a'], edge: '#2a2a33', shadow: 'rgba(42,42,51,.3)' },
            or: { c: ['#f2d27a', '#e9b860', '#f7e7b0'], edge: '#8a6a2a', glow: '#f2d27a' },
            vitrail: { c: ['#f2b630', '#e0442a', '#f4c96b'], edge: '#1a1c28' },
            abysses: { c: ['#c8fff4', '#7ff6ff', '#3dffb0'], edge: 'rgba(0,40,40,.5)', glow: '#3dffb0' },
        };
        function drawPellets(g, vis, mode) {
            const P = PELLET[mode] || PELLET.nuit;
            g.save();
            for (const p of S.food) {
                const age = S.t - p.born; if (age < 0) continue;
                const fade = (age > 9 ? 1 - (age - 9) / 3 : 1) * vis, land = Math.min(1, age * 4);
                const r = (p.r || 3) * (age > 9 ? .6 + .4 * fade : 1) * (1.5 - .5 * land), y = p.y + Math.sin(S.t * 1.8 + (p.bob || 0)) * .8;
                // petite onde quand le granulé touche l'eau
                if (age < .9) { g.globalAlpha = (1 - age / .9) * .5 * vis; g.strokeStyle = P.glow || P.edge; g.lineWidth = 1; g.beginPath(); g.ellipse(p.x, y, 3 + age * 16, (3 + age * 16) * .7, 0, 0, TAU); g.stroke(); }
                if (P.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = .1 * fade; g.fillStyle = P.glow; g.beginPath(); g.arc(p.x, y, r * 2.1, 0, TAU); g.fill(); g.globalCompositeOperation = 'source-over'; }
                if (P.shadow) { g.globalAlpha = fade; g.fillStyle = P.shadow; g.beginPath(); g.ellipse(p.x + 1.5, y + 2, r, r * .75, p.rot || 0, 0, TAU); g.fill(); }
                g.globalAlpha = fade * land; g.fillStyle = P.c[Math.floor((p.k || 0) * P.c.length)];
                g.beginPath(); g.ellipse(p.x, y, r, r * .78, p.rot || 0, 0, TAU); g.fill();
                g.strokeStyle = P.edge; g.lineWidth = mode === 'vitrail' ? 1.4 : .8; g.stroke();
                g.globalAlpha = fade * land * .85; g.fillStyle = 'rgba(255,255,255,.9)';
                g.beginPath(); g.arc(p.x - r * .35, y - r * .3, r * .28, 0, TAU); g.fill();
            }
            g.restore();
        }
        function artFood(g, vis, style, ring) {
            g.save();
            for (const r of S.rings) {
                const k = (S.t - r.born) / 1.6, rr = 6 + k * 60 * r.s;
                g.globalAlpha = (1 - k) * .5 * vis; g.strokeStyle = ring; g.lineWidth = 1.4;
                g.beginPath(); g.ellipse(r.x, r.y, rr, rr * .7, 0, 0, TAU); g.stroke();
            }
            g.restore();
            drawPellets(g, vis, style);
        }
        const snow = [], glowDots = [], jellies = [];
        function drawArt(style, vis) {
            const sc = artScene(style);
            for (const f of S.fish) if (!f.koi) f.koi = koiRobe(f);
            ctx.save(); ctx.globalAlpha = vis; ctx.drawImage(sc.bg, 0, 0, S.W, S.H); ctx.restore();
            const byDepth = [...S.sorted].sort((a, b) => (b.z || 0) - (a.z || 0));
            if (style === 'mosaique') { drawMosaic(vis, byDepth); return; }
            if (style === 'abysses') abyssBack(vis);
            if (style === 'aqua') {
                // le pigment fleurit dans l'eau derrière les carpes
                ctx.save(); ctx.globalCompositeOperation = 'multiply';
                for (const q of puffs) {
                    const k = (S.t - q.born) / 2.6, r = q.r * (1 + k * 2.2);
                    ctx.globalAlpha = vis * .12 * Math.pow(1 - k, 1.5) * Math.min(1, k * 8);
                    ctx.drawImage(puffSprite(q.c1), q.x + q.dx * k - r, q.y + q.dy * k - r, r * 2, r * 2);
                }
                ctx.restore();
            }
            const ringCol = { ukiyo: '#f3ead3', or: '#d8a64a', aqua: '#6d8fb0', papier: '#ffffff', vitrail: '#fff2c0', abysses: '#3dffb0' }[style];
            artFood(ctx, vis, style, ringCol);
            if (style === 'aqua') depthLayers(vis, 'aqua', 'multiply');
            else for (const f of byDepth) {
                const z = f.z || 0;
                if (style === 'papier' || style === 'vitrail') drawFish(f, vis, ctx, style);
                else { ctx.save(); if (z > .5 && style !== 'abysses') ctx.filter = `blur(${(z - .5) * 4}px)`; drawFish(f, vis * (1 - z * .45), ctx, style); ctx.restore(); }
            }
            if (style === 'abysses') abyssFront(vis);
            driftPads(ctx, sc.pads);
        }
        function abyssBack(vis) {
            if (!snow.length) for (let i = 0; i < 140; i++) snow.push({ x: rand(0, 1), y: rand(0, 1), r: rand(.4, 1.6), v: rand(.004, .015), w: rand(0, TAU) });
            if (!jellies.length) for (let i = 0; i < 3; i++) jellies.push({ x: rand(.1, .9), y: rand(.2, .9), s: rand(14, 24), ph: rand(0, TAU), c: ['#b26bff', '#2ef2ff', '#ff6ec7'][i] });
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#bfe8ff';
            for (const p of snow) {
                p.y += p.v / 60; if (p.y > 1.02) { p.y = -.02; p.x = rand(0, 1); }
                ctx.globalAlpha = vis * .35; ctx.beginPath(); ctx.arc(p.x * S.W + Math.sin(S.t * .3 + p.w) * 8, p.y * S.H, p.r, 0, TAU); ctx.fill();
            }
            for (const j of jellies) {
                const pulse = .5 + .5 * Math.sin(S.t * 1.6 + j.ph);
                j.y -= (.002 + pulse * .004) / 60 * 10; if (j.y < -.1) { j.y = 1.1; j.x = rand(.1, .9); }
                const x = j.x * S.W + Math.sin(S.t * .2 + j.ph) * 30, y = j.y * S.H, s = j.s * (1 + pulse * .12);
                const rg = ctx.createRadialGradient(x, y, 0, x, y, s * 2.4); rg.addColorStop(0, j.c); rg.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.globalAlpha = vis * .18; ctx.fillStyle = rg; ctx.fillRect(x - s * 2.4, y - s * 2.4, s * 4.8, s * 4.8);
                ctx.globalAlpha = vis * .55; ctx.strokeStyle = j.c; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.ellipse(x, y, s, s * (.7 - pulse * .12), 0, Math.PI, TAU); ctx.closePath(); ctx.stroke();
                ctx.globalAlpha = vis * .35;
                for (let k = 0; k < 5; k++) {
                    const tx = x - s * .7 + k * s * .35; ctx.beginPath(); ctx.moveTo(tx, y);
                    for (let t = 1; t <= 8; t++) ctx.lineTo(tx + Math.sin(S.t * 2 + k + t * .7) * 3, y + t * s * .32);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
        function abyssFront(vis) {
            // traînée de lumière derrière chaque carpe
            for (const f of S.fish) {
                if (Math.random() < .5 && glowDots.length < 500) {
                    const T = f.nodes[NODES - 2]; glowDots.push({ x: T.x + rand(-3, 3), y: T.y + rand(-3, 3), born: S.t, c: PAL.abysses[f.koi.base], vx: rand(-6, 6), vy: rand(-6, 6) });
                }
            }
            for (let i = glowDots.length - 1; i >= 0; i--) if (S.t - glowDots[i].born > 2.2) glowDots.splice(i, 1);
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            for (const p of glowDots) {
                const k = (S.t - p.born) / 2.2;
                ctx.globalAlpha = vis * (1 - k) * .7; ctx.fillStyle = p.c;
                ctx.beginPath(); ctx.arc(p.x + p.vx * k, p.y + p.vy * k, 1.2 * (1 - k * .5), 0, TAU); ctx.fill();
            }
            ctx.restore();
        }
        function drawMosaic(vis, byDepth) {
            const m = masks.mosa, t = m.cw;
            if (m.at !== S.frame) {
                m.g.setTransform(1, 0, 0, 1, 0, 0); m.g.clearRect(0, 0, m.cols, m.rows);
                m.g.setTransform(1 / t, 0, 0, 1 / t, 0, 0);
                m.g.fillStyle = '#2a2c36'; for (const p of S.food) m.g.fillRect(p.x - t * .5, p.y - t * .5, t, t);
                for (const f of byDepth) drawFish(f, 1, m.g, 'mosaique');
                m.g.fillStyle = '#5f9e5a';
                for (const pd of padSprites.ink) { const tt = S.t * .06 + pd.ph; m.g.save(); m.g.translate(pd.x + Math.sin(tt) * 7, pd.y + Math.cos(tt * .8) * 5); padShape(m.g, pd); m.g.fill(); m.g.restore(); }
                m.data = m.g.getImageData(0, 0, m.cols, m.rows).data; m.at = S.frame;
            }
            const data = m.data;
            ctx.save(); ctx.globalAlpha = vis;
            for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
                const i = (r * m.cols + c) * 4; if (data[i + 3] < 110) continue;
                const A = (cc, rr) => cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows ? 0 : data[(rr * m.cols + cc) * 4 + 3];
                const edge = A(c - 1, r) < 110 || A(c + 1, r) < 110 || A(c, r - 1) < 110 || A(c, r + 1) < 110, k = edge ? .55 : 1;
                ctx.fillStyle = '#9d9584'; ctx.fillRect(c * t, r * t, t, t);
                tile(ctx, c * t, r * t, t, [data[i] * k, data[i + 1] * k, data[i + 2] * k], c * 7919 + r * 104729 + 17);
            }
            ctx.restore();
        }

        function drawStyle(style, vis) {
            if (ART[style]) { drawArt(style, vis); return; }
            if (style === 'neon') { if (opts.decor) neonScene(vis); else for (const f of S.sorted) drawFish(f, vis, ctx, false); return; }
            if (style === 'pixel') { drawPixel(vis); return; }
            if (style === 'encre') { drawInk(vis); return; }
            if (style === 'plan') { drawPlan(vis); return; }
            if (style === 'holo') { drawHolo(vis); return; }
            if (style === 'thermique') { drawThermal(vis); return; }
            if (style === 'calli') { drawCalliScene(vis); return; }
            const m = mask(masks.text, vis), { cw, ch, cols, rows } = grid, data = m.data;
            const scroll = Math.floor(S.t * 5);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            // halo doux : la silhouette agrandie et lissée derrière les caractères
            ctx.imageSmoothingEnabled = true;
            if (opts.passage) {
                // sur les pages claires : une ombre sombre et floue sous les caractères pour garder l'effet néon
                ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'brightness(0) blur(6px)'; ctx.globalAlpha = .7 * vis;
                ctx.drawImage(m.c, 0, 0, cols * cw, rows * ch);
                ctx.filter = 'none'; ctx.globalCompositeOperation = 'lighter';
            }
            ctx.globalAlpha = style === 'matrix' ? .18 : .2;
            ctx.drawImage(m.c, 0, 0, cols * cw, rows * ch);
            ctx.font = (ch - 2) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const i = row * cols + col, a = data[i * 4 + 3], x = col * cw + cw / 2, y = row * ch + ch / 2;
                    let trail = 0;
                    if (style === 'matrix') {
                        const k = grid.drops[col].y - row;
                        trail = k >= 0 && k < 16 ? 1 - k / 16 : 0;
                        if (a < 18) {
                            if (trail > 0) { ctx.globalAlpha = .09 * trail * vis; ctx.fillStyle = '#2ef2ff'; ctx.fillText(KATA[grid.glyphs[i]], x, y); }
                            continue;
                        }
                    } else if (a < 18) continue;
                    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2], lum = a / 255;
                    const eye = r > 235 && gg > 235 && b > 235;
                    let c;
                    if (style === 'ascii') c = eye ? 'o' : RAMP[clamp(Math.round(lum * (RAMP.length - 1)), 1, RAMP.length - 1)];
                    else if (style === 'htop') c = eye ? '●' : lum > .5 ? '|' : '.';
                    else if (style === 'code') { c = CODE[(i + scroll) % CODE.length]; if (c === ' ') c = lum > .6 ? '·' : ' '; if (eye) c = '@'; }
                    else c = KATA[grid.glyphs[i]];
                    if (c === ' ') continue;
                    let alpha = .35 + .65 * lum;
                    if (style === 'matrix') {
                        alpha *= Math.max(.55, trail);
                        if (trail > .93) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = lum; ctx.fillText(c, x, y); continue; }
                    }
                    ctx.fillStyle = style === 'htop' ? (eye ? '#ff5a6e' : r > b * .8 ? '#ff5a6e' : gg > 200 ? '#5af78e' : '#57c7ff') : eye ? '#ffffff' : 'rgb(' + r + ',' + gg + ',' + b + ')';
                    ctx.globalAlpha = alpha;
                    ctx.fillText(c, x, y);
                }
            }
            ctx.restore();
            if (style === 'htop') htopLabels(vis);
            if (opts.decor && (style === 'ascii' || style === 'code') && haikuNight) { ctx.save(); ctx.globalAlpha = vis; ctx.drawImage(haikuNight, 0, 0, S.W, S.H); ctx.restore(); }
        }

        // htop : une étiquette de processus au-dessus de chaque poisson, son CPU monte quand il mange
        function htopLabels(vis) {
            ctx.save(); ctx.font = '11px ' + FONT; ctx.textBaseline = 'bottom';
            for (const f of S.sorted) {
                const h = f.nodes[0], cpu = Math.round(2 + f.heat * 95), bar = '|'.repeat(Math.round(cpu / 10)).padEnd(10, ' ');
                const txt = `PID ${f.pid} poisson ${cpu.toString().padStart(3)}% [${bar}]`;
                const x = clamp(h.x - 60, 4, S.W - 230), y = clamp(h.y - f.w * 2, 14, S.H - 4);
                ctx.globalAlpha = .75 * vis; ctx.fillStyle = '#060a1e'; ctx.fillRect(x - 3, y - 13, ctx.measureText(txt).width + 6, 15);
                ctx.globalAlpha = vis; ctx.fillStyle = cpu > 60 ? '#ff5a6e' : cpu > 30 ? '#ffd166' : '#5af78e'; ctx.fillText(txt, x, y);
            }
            ctx.restore();
        }

        // Encre : les poissons laissent des traînées de lavis qui s'effacent lentement
        const trail = document.createElement('canvas'), tctx = trail.getContext('2d');
        function drawInk(vis) {
            if (trail.width !== Math.ceil(S.W / 2) || trail.height !== Math.ceil(S.H / 2)) { trail.width = Math.ceil(S.W / 2); trail.height = Math.ceil(S.H / 2); }
            if (S.inkAt !== S.frame) {
                S.inkAt = S.frame;
                tctx.globalCompositeOperation = 'destination-out'; tctx.globalAlpha = .025; tctx.fillRect(0, 0, trail.width, trail.height);
                tctx.globalCompositeOperation = 'source-over';
                for (const f of S.sorted) {
                    const T = f.nodes[NODES - 1], k = f.nodes[NODES >> 1];
                    tctx.globalAlpha = .05 * vis; tctx.fillStyle = f.robe[0];
                    tctx.beginPath(); tctx.arc(k.x / 2, k.y / 2, f.w * .9, 0, TAU); tctx.fill();
                    tctx.beginPath(); tctx.arc(T.x / 2, T.y / 2, f.w * .5, 0, TAU); tctx.fill();
                }
            }
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.imageSmoothingEnabled = true; ctx.globalAlpha = .9;
            ctx.drawImage(trail, 0, 0, S.W, S.H); ctx.restore();
            for (const f of S.sorted) drawFish(f, vis, ctx, 'encre');
        }

        // Plan technique : quadrillage local, traits blancs et cotes
        function drawPlan(vis) {
            ctx.save(); ctx.strokeStyle = '#7fb8ff'; ctx.lineWidth = 1;
            for (const f of S.sorted) {
                const h = f.nodes[0], r = f.len * .75;
                ctx.globalAlpha = .18 * vis;
                const x0 = Math.floor((h.x - r) / 20) * 20, y0 = Math.floor((h.y - r) / 20) * 20;
                ctx.save(); ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU); ctx.clip();
                ctx.beginPath();
                for (let x = x0; x < h.x + r; x += 20) { ctx.moveTo(x, h.y - r); ctx.lineTo(x, h.y + r); }
                for (let y = y0; y < h.y + r; y += 20) { ctx.moveTo(h.x - r, y); ctx.lineTo(h.x + r, y); }
                ctx.stroke(); ctx.restore();
            }
            ctx.restore();
            for (const f of S.sorted) drawFish(f, vis, ctx, 'plan');
        }

        // Hologramme : trois passes décalées (rouge, cyan, violet), lignes de balayage et tranches qui glissent
        function drawHolo(vis) {
            const j = Math.sin(S.t * 13) * Math.sin(S.t * 3.1) > .7 ? 5 : 2;
            const PASSES = [[-j, 0, '#ff2a6d'], [j, 0, '#2ef2ff'], [0, 0, '#b26bff']];
            for (const [dx, dy, col] of PASSES) {
                ctx.save(); ctx.translate(dx, dy);
                for (const f of S.sorted) drawFish(f, vis * .6, ctx, false, { c1: col, c2: col });
                ctx.restore();
            }
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = .45; ctx.fillStyle = '#000';
            const off = (S.t * 40) % 4;
            for (let y = off; y < S.H; y += 4) ctx.fillRect(0, y, S.W, 1.5);
            ctx.restore();
            if (Math.random() < .08) {
                const y = Math.random() * S.H, h = 6 + Math.random() * 24, dx = (Math.random() - .5) * 40, d = S.dpr;
                ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.drawImage(cv, 0, y * d, cv.width, h * d, dx * d, y * d, cv.width, h * d);
                ctx.restore();
            }
        }

        // Thermique : vision infrarouge, les poissons qui viennent de manger chauffent
        const HEAT = [[0, 0, 0], [20, 10, 90], [110, 20, 160], [210, 40, 90], [255, 120, 20], [255, 220, 60], [255, 255, 255]];
        const hc = document.createElement('canvas'), hctx = hc.getContext('2d');
        function drawThermal(vis) {
            const m = mask(masks.heat, vis), { cols, rows, data } = m;
            if (hc.width !== cols || hc.height !== rows) { hc.width = cols; hc.height = rows; }
            const img = hctx.createImageData(cols, rows), o = img.data;
            for (let i = 0; i < cols * rows; i++) {
                const a = data[i * 4 + 3]; if (a < 10) continue;
                const v = data[i * 4] / 255 * (HEAT.length - 1), k = Math.min(HEAT.length - 2, v | 0), fr = v - k, c0 = HEAT[k], c1 = HEAT[k + 1];
                o[i * 4] = c0[0] + (c1[0] - c0[0]) * fr; o[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * fr; o[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * fr; o[i * 4 + 3] = a;
            }
            hctx.putImageData(img, 0, 0);
            ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = vis;
            ctx.filter = 'blur(3px)'; ctx.drawImage(hc, 0, 0, cols * m.cw, rows * m.ch);
            ctx.filter = 'none'; ctx.globalAlpha = .7 * vis; ctx.drawImage(hc, 0, 0, cols * m.cw, rows * m.ch);
            ctx.font = '11px ' + FONT; ctx.globalAlpha = .85 * vis; ctx.fillStyle = '#ffd166';
            for (const f of S.sorted) { const h = f.nodes[0]; ctx.fillText((24 + f.heat * 14).toFixed(1) + ' °C', h.x + 10, h.y - f.w * 1.6); }
            ctx.restore();
        }

        // Pixel art : grosses cases nettes, tramage aux bords, liseré clair en haut et ombre en bas
        function drawPixel(vis) {
            const m = mask(masks.pixel, vis), { cw, cols, rows, data } = m;
            const A = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : data[(r * cols + c) * 4 + 3]);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const i = row * cols + col, a = data[i * 4 + 3];
                    if (a < 40) continue;
                    if (a < 90 && (a - 40) / 50 * 16 < BAYER[(row & 3) * 4 + (col & 3)] + .5) continue;
                    let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
                    const eye = r > 235 && g > 235 && b > 235;
                    if (!eye) {
                        if (A(col, row - 1) < 40) { r += (255 - r) * .5; g += (255 - g) * .5; b += (255 - b) * .5; }
                        else if (A(col, row + 1) < 40) { r *= .5; g *= .5; b *= .6; }
                        // 4 niveaux par canal, pour l'aspect palette limitée
                        r = Math.round(r / 85) * 85; g = Math.round(g / 85) * 85; b = Math.round(b / 85) * 85;
                    }
                    ctx.globalAlpha = Math.min(1, .5 + a / 255) * vis;
                    ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
                    ctx.fillRect(col * cw, row * cw, cw, cw);
                }
            }
            ctx.restore();
        }


        // ---------- calligraphie japonaise : sumi-e sur papier de riz ----------
        // Techniques à comparer (S.tech) : lavis, pinceau (poils), mouillé (couleurs qui bavent), papier (l'encre boit le grain), contour (trait vivant)
        let koiN = 0;
        function koiRobe(f) {
            const v = VARIETES[koiN++ % VARIETES.length], r = () => Math.random(), P = [];
            const saddles = (c) => {
                if (r() < .8) P.push({ u: .1, v: (r() - .5) * .2, ru: .07, rv: 1.1, c });
                const n = 2 + (r() * 2 | 0), span = .5 / n;
                for (let j = 0; j < n; j++) P.push({ u: .26 + span * (j + .5) + (r() - .5) * span * .3, v: (r() - .5) * .5, ru: span * (.36 + r() * .12), rv: .8 + r() * .4, c });
            };
            let base = 0;
            if (v === 'kohaku') saddles(1);
            else if (v === 'sanke') { saddles(1); for (let j = 0; j < 5; j++) P.push({ u: .22 + r() * .45, v: (r() - .5) * 1.2, ru: .02, rv: .22, c: 2 }); }
            else if (v === 'showa') { base = 2; saddles(1); P.push({ u: .5, v: .3, ru: .06, rv: .5, c: 0 }); }
            else if (v === 'tancho') P.push({ u: .1, v: 0, ru: .045, rv: .75, c: 1 });
            else if (v === 'ogon') base = 3;
            else if (v === 'karasu') base = 2;
            else if (v === 'higoi') { base = 1; P.push({ u: .45, v: .35, ru: .08, rv: .45, c: 0 }); }
            // poils du pinceau pour chaque tache
            for (const p of P) p.h = Array.from({ length: 10 }, () => ({ o: rand(-.9, .9) * p.rv, u0: rand(-1.1, -.7) * p.ru, u1: rand(.7, 1.1) * p.ru, a: rand(.5, 1) }));
            // queues et nageoires en voile, comme les poissons de Shozo Koike
            const voile = v === 'karasu' || v === 'ogon' || r() < .25;
            f.z = rand(0, .9); f.zT = f.z; f.zNext = 0;
            return { base, patches: P, voile, kiwa: r() < .5,
                wisp: Array.from({ length: 16 }, () => [rand(1.3, 2.1), rand(.5, 1.6), rand(.12, .28), rand(0, TAU)]),
                hairs: Array.from({ length: 24 }, (_, j) => ({ o: (j / 23 - .5) * 1.9 + rand(-.03, .03), a: rand(.45, 1), s: rand(0, .05), e: rand(.8, 1), w: rand(.7, 1.4) })) };
        }
        // touche de pinceau en feuille : appuyée à la racine, effilée au bout
        function dab(g, x, y, an, len, wid, col, al) {
            const ex = x + Math.cos(an) * len, ey = y + Math.sin(an) * len, nx = -Math.sin(an), ny = Math.cos(an), mx = (x + ex) / 2, my = (y + ey) / 2;
            g.beginPath(); g.moveTo(x, y);
            g.quadraticCurveTo(mx + nx * wid, my + ny * wid, ex, ey);
            g.quadraticCurveTo(mx - nx * wid * .55, my - ny * wid * .55, x, y);
            const gr = g.createLinearGradient(x, y, ex, ey);
            gr.addColorStop(0, ink(col, al)); gr.addColorStop(.6, ink(col, al * .75)); gr.addColorStop(1, ink(col, al * .3));
            g.fillStyle = gr; g.fill();
            g.strokeStyle = ink(col, al * .55); g.lineWidth = .6;
            for (let j = -1; j <= 1; j++) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx + nx * wid * j * .5, my + ny * wid * j * .5, ex + nx * wid * j * .4, ey + ny * wid * j * .4); g.stroke(); }
        }
        // point de l'épine à l'abscisse u (0 museau, 1 queue)
        function at(P, u) {
            const x = clamp(u, 0, 1) * (NODES - 1), i = Math.min(NODES - 2, x | 0), t = x - i, A = P[i], B = P[i + 1];
            return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, tx: A.tx, ty: A.ty, u };
        }
        // un trait qui suit le corps, à un écart donné (en largeurs) de l'épine
        function along(g, f, P, u0, u1, off) {
            g.beginPath();
            for (let u = u0, k = 0; u <= u1 + 1e-6; u += .5 / (NODES - 1), k++) {
                const c = at(P, u), w = width(f, u) * off, x = c.x - c.ty * w, y = c.y + c.tx * w;
                k ? g.lineTo(x, y) : g.moveTo(x, y);
            }
        }
        // Sumi-e : la carpe n'a pas de contour, elle est faite de touches d'encre mouillée qui se superposent
        const inkSprites = new Map();
        function inkSprite(c) {
            const key = c.join(); if (inkSprites.has(key)) return inkSprites.get(key);
            const sp = document.createElement('canvas'); sp.width = sp.height = 64;
            const x = sp.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
            // cœur dilué, bord mouillé plus sombre, puis l'encre qui file dans le papier
            gr.addColorStop(0, ink(c, .5)); gr.addColorStop(.62, ink(c, .58)); gr.addColorStop(.82, ink(c, .9)); gr.addColorStop(.9, ink(c, .35)); gr.addColorStop(1, ink(c, 0));
            x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
            // granulation
            x.globalCompositeOperation = 'destination-out';
            for (let i = 0; i < 140; i++) { x.fillStyle = `rgba(0,0,0,${rand(.1, .4)})`; x.fillRect(rand(0, 64), rand(0, 64), rand(1, 2.5), rand(1, 2.5)); }
            inkSprites.set(key, sp); return sp;
        }
        function hairs(g, x, y, an, len, spread, n, col, al, wv) {
            g.strokeStyle = ink(col, al); g.lineCap = 'round';
            for (let j = 0; j < n; j++) {
                const t = n > 1 ? j / (n - 1) - .5 : 0, a2 = an + t * spread + Math.sin(wv + j) * .06, l = len * (1 - Math.abs(t) * .35);
                g.lineWidth = 1.6 - Math.abs(t) * 1.6 + .4;
                g.beginPath(); g.moveTo(x, y);
                g.quadraticCurveTo(x + Math.cos(an + t * spread * .4) * l * .55, y + Math.sin(an + t * spread * .4) * l * .55, x + Math.cos(a2) * l, y + Math.sin(a2) * l); g.stroke();
            }
        }
        function drawSumie(f, g, a, P, eyes, tl) {
            const K = f.koi, pale = K.base === 0, SUMI = [22, 20, 22], z = f.z || 0;
            const tone = K.base === 1 ? [190, 52, 30] : K.base === 3 ? [176, 122, 44] : K.base === 2 ? SUMI : [96, 90, 86];
            g.lineJoin = g.lineCap = 'round';
            const { T, ba, sw, fl } = tl;
            f.lag = (f.lag || 0) + (sw - (f.lag || 0)) * .06;
            // queue et nageoires : quelques poils de pinceau sec qui flottent
            g.globalAlpha = a;
            const finTone = pale ? [80, 74, 70] : tone;
            for (let j = 0; j < 2; j++) hairs(g, T.x, T.y, ba + (j ? 1 : -1) * (.32 + sw * .5) + f.lag * 1.2, fl * (K.voile ? 1.9 : 1.25), .55, K.voile ? 9 : 6, finTone, .2, f.phase * .6);
            for (const s of [1, -1]) {
                const p = P[3], w = width(f, p.u), ox = p.x - s * p.ty * w, oy = p.y + s * p.tx * w;
                const an = Math.atan2(-p.ty, -p.tx) + s * (1 + Math.sin(f.phase * .7 + s) * .25);
                hairs(g, ox, oy, an, f.w * (K.voile ? 3 : 2.3), .5, 5, finTone, .2, f.phase);
                const q = P[8], wq = width(f, q.u) * .8;
                hairs(g, q.x - s * q.ty * wq, q.y + s * q.tx * wq, Math.atan2(-q.ty, -q.tx) + s * .8, f.w * 1.3, .4, 3, finTone, .18, f.phase + 2);
            }
            // corps : touches mouillées posées le long de l'épine, plus chargées à la tête
            for (let u = 0; u <= 1.0001; u += .03) {
                const c = at(P, u), w = width(f, u);
                let col = tone, al = pale ? .08 : K.base === 2 ? .27 : .23;
                for (const p of K.patches) if (Math.abs(u - p.u) < p.ru * 1.1) { col = p.c === 0 ? null : p.c === 2 ? SUMI : [196, 58, 34]; al = p.c === 2 ? .28 : .22; }
                if (!col) continue;
                if (u < .16) al *= 1.5;
                const r = w * (1.2 + (u < .12 ? .25 : 0)), sp = inkSprite(col);
                g.globalAlpha = a * al * (1 - u * .35);
                g.drawImage(sp, c.x - r + Math.sin(u * 37 + f.pid) * w * .12, c.y - r + Math.cos(u * 29 + f.pid) * w * .12, r * 2, r * 2);
            }
            // koï blanc : seul le bord est tracé, d'un trait gris interrompu
            if (pale) {
                g.globalAlpha = a; g.strokeStyle = 'rgba(40,36,34,.45)'; g.lineWidth = 1.1;
                for (const s of [1, -1]) {
                    g.setLineDash([rand(18, 40), rand(4, 10)]); g.beginPath();
                    for (let i = 0; i < NODES - 3; i++) { const p = P[i], w = width(f, p.u) * s; i ? g.lineTo(p.x - p.ty * w, p.y + p.tx * w) : g.moveTo(p.x - p.ty * w, p.y + p.tx * w); }
                    g.stroke();
                }
                g.setLineDash([]);
            }
            // quelques traits d'encre noire : dos, ouïe, écailles
            g.globalAlpha = a;
            g.strokeStyle = ink(SUMI, K.base === 2 ? .55 : .35); g.lineWidth = f.w * .14;
            g.setLineDash([f.len * .12, f.len * .02, f.len * .06, f.len * .03]);
            g.beginPath(); for (let i = 3; i < NODES - 5; i++) { const p = P[i]; i === 3 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y); } g.stroke(); g.setLineDash([]);
            {
                const c = at(P, .17), w = width(f, .17) * .85;
                g.strokeStyle = ink(SUMI, .5); g.lineWidth = 1.4;
                g.beginPath(); g.moveTo(c.x - c.ty * w, c.y + c.tx * w); g.quadraticCurveTo(c.x + c.tx * f.w * .5, c.y + c.ty * f.w * .5, c.x + c.ty * w, c.y - c.tx * w); g.stroke();
            }
            g.strokeStyle = ink(SUMI, .3); g.lineWidth = 1;
            for (let i = 5; i < NODES - 6; i += 2) for (const v of [-.45, .45]) {
                const p = P[i], w = width(f, p.u) * v, an = Math.atan2(p.ty, p.tx);
                g.beginPath(); g.arc(p.x - p.ty * w, p.y + p.tx * w, f.w * .28, an + 2.2, an + 4.1); g.stroke();
            }
            // yeux, barbillons
            const H = P[0], sx = H.x + H.tx * f.w * .5, sy = H.y + H.ty * f.w * .5;
            for (const s of [1, -1]) {
                const e = eyes(s); g.fillStyle = 'rgba(10,9,9,.9)'; g.beginPath(); g.arc(e[0], e[1], Math.max(1.6, f.w * .13), 0, TAU); g.fill();
                const mx = sx - s * H.ty * f.w * .3, my = sy + s * H.tx * f.w * .3, an = Math.atan2(H.ty, H.tx) + s * (1.9 + Math.sin(f.phase * .7 + s) * .3);
                g.strokeStyle = 'rgba(30,26,24,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(mx, my);
                g.quadraticCurveTo(mx + Math.cos(an - s * .5) * f.w * .5, my + Math.sin(an - s * .5) * f.w * .5, mx + Math.cos(an) * f.w * .85, my + Math.sin(an) * f.w * .85); g.stroke();
            }
        }
        function drawCalli(f, g, a, P, Lp, Rp, body, tail, fin, eyes, tl) {
            const K = f.koi || (f.koi = koiRobe(f)), base = INKC[K.base], pale = K.base === 0, finC = pale ? INKC[0] : base, tech = S.tech, z = f.z || 0;
            if (tech === 'sumie') return drawSumie(f, g, a, P, eyes, tl);
            g.lineJoin = g.lineCap = 'round';
            g.globalAlpha = a;
            // ombre sur le fond : plus proche quand la carpe est profonde
            g.save(); g.translate(2 + 7 * (1 - z), 3 + 10 * (1 - z)); g.fillStyle = `rgba(80,60,40,${.07 * (1 - z * .5)})`; body(); g.fill(); g.restore();
            const { T, ba, sw, fl } = tl;
            f.lag = (f.lag || 0) + (sw - (f.lag || 0)) * .06;
            if (K.voile) {
                for (let j = 0; j < K.wisp.length; j++) {
                    const [lk, lw, al, ph] = K.wisp[j], sp = (j / (K.wisp.length - 1) - .5) * 1.15, l = fl * lk;
                    const c1 = ba + sp * .45 + sw * .7, c2 = ba + sp + f.lag * 1.8 + Math.sin(f.phase * .6 + ph) * .12;
                    g.strokeStyle = ink(finC, al * (pale ? .8 : 1)); g.lineWidth = lw;
                    g.beginPath(); g.moveTo(T.x, T.y);
                    g.quadraticCurveTo(T.x + Math.cos(c1) * l * .5, T.y + Math.sin(c1) * l * .5, T.x + Math.cos(c2) * l, T.y + Math.sin(c2) * l); g.stroke();
                }
            }
            tail(); g.fillStyle = ink(finC, pale ? .14 : K.voile ? .22 : .32); g.fill();
            g.strokeStyle = ink(finC, pale ? .32 : .5); g.lineWidth = .8;
            for (let j = -4; j <= 4; j++) {
                const an = ba + j / 4 * .5 + sw, l = fl * (1 - Math.abs(j) * .015) * (j % 2 ? .93 : 1);
                const mx = T.x + Math.cos(ba + j / 4 * .35 + sw * .6) * l * .5, my = T.y + Math.sin(ba + j / 4 * .35 + sw * .6) * l * .5;
                g.beginPath(); g.moveTo(T.x, T.y); g.quadraticCurveTo(mx, my, T.x + Math.cos(an) * l, T.y + Math.sin(an) * l); g.stroke();
            }
            const fa = pale ? .3 : .62, fk = K.voile ? 1.4 : 1;
            for (const s of [1, -1]) {
                const fp = fin(s);
                dab(g, fp.ox, fp.oy, fp.an, f.w * 2.3 * fk, f.w * .8, finC, fa);
                if (K.voile) for (let j = 0; j < 4; j++) {
                    const an = fp.an + s * (j - 1.5) * .12 + Math.sin(f.phase * .7 + j) * .08, l = f.w * (3.6 + j * .3);
                    g.strokeStyle = ink(finC, .16); g.lineWidth = .7; g.beginPath(); g.moveTo(fp.ox, fp.oy);
                    g.quadraticCurveTo(fp.ox + Math.cos(fp.an) * l * .5, fp.oy + Math.sin(fp.an) * l * .5, fp.ox + Math.cos(an) * l, fp.oy + Math.sin(an) * l); g.stroke();
                }
                const q = P[8], w = width(f, q.u) * .8, back = Math.atan2(-q.ty, -q.tx) + s * (.75 + Math.sin(f.phase * .7 + s + 1) * .15);
                dab(g, q.x - s * q.ty * w, q.y + s * q.tx * w, back, f.w * 1.3 * fk, f.w * .45, finC, fa * .85);
            }

            // tête de koï : museau large et arrondi, sous le corps
            const hc = at(P, .07), hw0 = width(f, .1) * 1.08, han = Math.atan2(hc.ty, hc.tx);
            const head = () => { g.beginPath(); g.ellipse(hc.x + hc.tx * f.w * .15, hc.y + hc.ty * f.w * .15, f.w * 1.05, hw0, han, 0, TAU); };

            // corps
            if (tech === 'mouille') {
                // l'encre bave autour du corps encore humide
                g.save(); g.filter = 'blur(5px)'; g.fillStyle = ink(base, pale ? .05 : .22); body(); g.fill(); g.restore();
            } else { body(); g.strokeStyle = ink(base, pale ? .05 : .13); g.lineWidth = 5; g.stroke(); }
            const H = P[0], E = P[NODES - 1];
            if (tech === 'pinceau') {
                // une vingtaine de poils qui se séparent vers la queue
                for (const h of K.hairs) {
                    g.strokeStyle = ink(base, (pale ? .13 : .6) * h.a); g.lineWidth = f.w * .17 * h.w;
                    along(g, f, P, h.s, h.e, h.o * .95); g.stroke();
                }
                g.fillStyle = ink(base, pale ? .06 : .55); head(); g.fill();
            } else {
                const gr = g.createLinearGradient(H.x, H.y, E.x, E.y);
                if (pale) { gr.addColorStop(0, ink(base, .1)); gr.addColorStop(1, ink(base, .04)); }
                else { gr.addColorStop(0, ink(base, .92)); gr.addColorStop(.55, ink(base, .8)); gr.addColorStop(1, ink(base, .4)); }
                g.fillStyle = gr; head(); g.fill(); body(); g.fill();
            }
            g.save(); body(); g.clip();
            // taches de la robe
            for (const p of K.patches) {
                const col = INKC[p.c];
                if (p.c === 0) g.globalCompositeOperation = 'destination-out';
                if (tech === 'pinceau') {
                    for (const h of p.h) {
                        g.strokeStyle = ink(col, (p.c === 0 ? .55 : .62) * h.a); g.lineWidth = width(f, p.u) * p.rv * .45;
                        along(g, f, P, p.u + h.u0, p.u + h.u1, p.v + h.o); g.stroke();
                    }
                } else {
                    const c = at(P, p.u), w = width(f, p.u), cx = c.x - c.ty * p.v * w, cy = c.y + c.tx * p.v * w, al = p.c === 0 ? .7 : .88;
                    const sharp = K.kiwa && tech !== 'mouille', R = sharp ? 1 : 1.2;
                    g.save(); g.translate(cx, cy); g.rotate(Math.atan2(c.ty, c.tx)); g.scale(p.ru * f.len, p.rv * w);
                    const rg = g.createRadialGradient(0, 0, 0, 0, 0, R);
                    if (sharp) { rg.addColorStop(0, ink(col, al * .85)); rg.addColorStop(.9, ink(col, al * .92)); rg.addColorStop(.97, ink(col, al)); rg.addColorStop(1, ink(col, 0)); }
                    else { rg.addColorStop(0, ink(col, al * .72)); rg.addColorStop(.62, ink(col, al * .8)); rg.addColorStop(.8, ink(col, al)); rg.addColorStop(1, ink(col, 0)); }
                    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.restore();
                }
                g.globalCompositeOperation = 'source-over';
            }
            // pinceau sec : stries de papier le long du corps
            if (!pale && tech !== 'pinceau') {
                if (!f.dash) f.dash = Array.from({ length: 7 }, () => [rand(6, 30), rand(2, 9), rand(4, 20), rand(1, 6)]);
                g.strokeStyle = 'rgba(241,234,219,.22)'; g.lineWidth = 1.1;
                for (let j = 0; j < 7; j++) { g.setLineDash(f.dash[j]); along(g, f, P, 0, 1, (j / 6 - .5) * 1.6); g.stroke(); }
                g.setLineDash([]);
            }
            // tête appuyée
            if (!pale) {
                const r0 = hw0 * 1.15, hg = g.createRadialGradient(hc.x, hc.y, 0, hc.x, hc.y, r0);
                const dk = K.base === 1 ? [140, 24, 12] : K.base === 3 ? [140, 80, 18] : [6, 5, 7];
                hg.addColorStop(0, ink(dk, .65)); hg.addColorStop(.7, ink(dk, .4)); hg.addColorStop(1, ink(dk, 0));
                g.fillStyle = hg; g.beginPath(); g.arc(hc.x, hc.y, r0, 0, TAU); g.fill();
            }
            // écailles en filet sur le dos, qui s'efface vers les flancs
            const net = K.base === 1 ? [110, 16, 8] : K.base === 3 ? [110, 62, 8] : K.base === 2 ? [241, 234, 219] : [60, 54, 48];
            const na = (K.base === 2 ? .22 : pale ? .28 : .5) * (tech === 'pinceau' ? .7 : 1);
            for (const [ext, al] of [[.55, 1], [1, .28]]) {
                g.strokeStyle = ink(net, na * al); g.lineWidth = .9; g.beginPath();
                for (let i = 3; i < NODES - 6; i++) {
                    const A = P[i], B = P[i + 2], wa = width(f, A.u) * ext, wb = width(f, B.u) * ext;
                    g.moveTo(A.x - A.ty * wa, A.y + A.tx * wa); g.lineTo(B.x + B.ty * wb, B.y - B.tx * wb);
                    g.moveTo(A.x + A.ty * wa, A.y - A.tx * wa); g.lineTo(B.x - B.ty * wb, B.y + B.tx * wb);
                }
                g.stroke();
            }
            // reflet : une bande laissée en réserve le long du dos
            if (!pale) { g.strokeStyle = 'rgba(244,238,226,.42)'; g.lineWidth = f.w * .2; along(g, f, P, .16, .6, .3); g.stroke(); }
            // trait d'ouïe derrière les yeux
            {
                const c = at(P, .17), w = width(f, .17) * .92, fx = c.tx * f.w * .55, fy = c.ty * f.w * .55;
                g.strokeStyle = K.base === 2 ? 'rgba(241,234,219,.35)' : pale ? 'rgba(60,54,48,.4)' : 'rgba(60,10,6,.45)'; g.lineWidth = 1.2;
                g.beginPath(); g.moveTo(c.x - c.ty * w, c.y + c.tx * w); g.quadraticCurveTo(c.x + fx, c.y + fy, c.x + c.ty * w, c.y - c.tx * w); g.stroke();
            }
            g.restore();
            // contour
            if (tech === 'contour') {
                // trait vivant : appuyé d'un côté, fin et interrompu de l'autre
                body(); g.strokeStyle = ink(pale ? [48, 42, 38] : base, .25); g.lineWidth = .5; g.stroke();
                const sd = (f.pid & 1) ? 1 : -1, A = sd > 0 ? Lp : Rp, B = sd > 0 ? Rp : Lp, n = A.length;
                g.strokeStyle = pale ? 'rgba(30,26,24,.8)' : ink(base, .9);
                for (let i = 0; i < n - 1; i++) {
                    g.lineWidth = .8 + 2.6 * Math.pow(Math.sin(Math.PI * i / (n - 1)), .7);
                    g.beginPath(); g.moveTo(A[i].x, A[i].y); g.lineTo(A[i + 1].x, A[i + 1].y); g.stroke();
                }
                g.lineWidth = .7;
                for (let i = 0; i < n - 1; i++) {
                    if (((i * 7 + f.pid) % 5) === 0) continue;
                    g.beginPath(); g.moveTo(B[i].x, B[i].y); g.lineTo(B[i + 1].x, B[i + 1].y); g.stroke();
                }
            } else if (tech === 'mouille') {
                // bord plus foncé là où l'aquarelle sèche
                g.save(); g.filter = 'blur(.8px)'; body(); g.strokeStyle = pale ? 'rgba(48,42,38,.5)' : ink(base, .55); g.lineWidth = 1.6; g.stroke(); g.restore();
            } else { body(); g.strokeStyle = pale ? 'rgba(48,42,38,.55)' : ink(base, .5); g.lineWidth = pale ? 1.3 : .9; g.stroke(); }
            // yeux avec un point de lumière, barbillons
            const sx = H.x + H.tx * f.w * .5, sy = H.y + H.ty * f.w * .5;
            for (const s of [1, -1]) {
                const e = eyes(s), r = Math.max(1.8, f.w * .15);
                g.fillStyle = 'rgba(12,10,10,.92)'; g.beginPath(); g.arc(e[0], e[1], r, 0, TAU); g.fill();
                g.fillStyle = 'rgba(250,246,238,.9)'; g.beginPath(); g.arc(e[0] - r * .3, e[1] - r * .35, r * .35, 0, TAU); g.fill();
                const mx = sx - s * H.ty * f.w * .3, my = sy + s * H.tx * f.w * .3, an = Math.atan2(H.ty, H.tx) + s * (1.9 + Math.sin(f.phase * .7 + s) * .3);
                g.strokeStyle = 'rgba(30,26,24,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(mx, my);
                g.quadraticCurveTo(mx + Math.cos(an - s * .5) * f.w * .5, my + Math.sin(an - s * .5) * f.w * .5, mx + Math.cos(an) * f.w * .8, my + Math.sin(an) * f.w * .8); g.stroke();
            }
            if (!pale) {
                const m = at(P, .03), w = width(f, .03) * 1.1, an = Math.atan2(m.ty, m.tx);
                g.strokeStyle = 'rgba(241,234,219,.7)'; g.lineWidth = 1.1;
                for (const k of [0, .5]) { g.beginPath(); g.ellipse(m.x + m.tx * k * 2, m.y + m.ty * k * 2, w * .45, w, an, -1.2, 1.2); g.stroke(); }
            }
        }

        // ---------- le décor : papier, soleil, cerisier, nénuphars, haïku ----------
        let paper = null, bough = null, grain = null, boughNight = null, sunNight = null, haikuNight = null, padSprites = null;
        // dérive très lente des nénuphars (quelques pixels, une légère rotation)
        function drawPads(g, night) {
            if (!padSprites) return;
            for (const pd of padSprites[night ? 'night' : 'ink']) {
                const t = S.t * .06 + pd.ph, x = pd.x + Math.sin(t) * 7 + Math.sin(t * 2.3) * 2, y = pd.y + Math.cos(t * .8) * 5, rot = Math.sin(t * .7) * .05;
                g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(pd.c, -pd.R2, -pd.R2, pd.R2 * 2, pd.R2 * 2); g.restore();
            }
        }
        const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", serif';
        function makePaper() {
            const W = S.W, H = S.H, d = S.dpr, small = W < 640;
            paper = document.createElement('canvas'); paper.width = Math.round(W * d); paper.height = Math.round(H * d);
            const p = paper.getContext('2d'); p.scale(d, d);
            p.fillStyle = '#f1eadb'; p.fillRect(0, 0, W, H);
            for (let i = 0; i < W * H / 900; i++) {
                const x = Math.random() * W, y = Math.random() * H, an = Math.random() * TAU, l = rand(4, 22);
                p.strokeStyle = Math.random() < .5 ? 'rgba(120,100,70,.05)' : 'rgba(255,255,255,.35)'; p.lineWidth = rand(.4, 1);
                p.beginPath(); p.moveTo(x, y); p.quadraticCurveTo(x + Math.cos(an + .5) * l * .5, y + Math.sin(an + .5) * l * .5, x + Math.cos(an) * l, y + Math.sin(an) * l); p.stroke();
            }
            const vg = p.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75);
            vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(110,85,50,.14)'); p.fillStyle = vg; p.fillRect(0, 0, W, H);
            // soleil rouge à l'aquarelle
            const R = clamp(Math.min(W, H) * .13, 50, 130), sx = small ? W * .34 : W * .2, sy = small ? H * .2 : H * .27;
            p.save(); p.beginPath(); p.arc(sx, sy, R, 0, TAU); p.clip();
            p.fillStyle = 'rgba(206,46,22,.72)'; p.fillRect(sx - R, sy - R, R * 2, R * 2);
            for (let i = 0; i < R * R * .5; i++) { p.fillStyle = Math.random() < .5 ? `rgba(150,20,10,${rand(.05, .18)})` : `rgba(255,200,170,${rand(.04, .12)})`; p.fillRect(sx + rand(-R, R), sy + rand(-R, R), rand(.6, 1.8), rand(.6, 1.8)); }
            for (let i = 0; i < 7; i++) {
                const an = rand(0, TAU), dd = rand(.2, .7) * R, x = sx + Math.cos(an) * dd, y = sy + Math.sin(an) * dd, gr = p.createRadialGradient(x, y, 0, x, y, R * rand(.2, .45));
                gr.addColorStop(0, 'rgba(255,170,130,.22)'); gr.addColorStop(1, 'rgba(255,170,130,0)'); p.fillStyle = gr; p.fillRect(sx - R, sy - R, R * 2, R * 2);
            }
            p.restore();
            p.strokeStyle = 'rgba(170,30,15,.35)'; p.lineWidth = 2.2; p.beginPath(); p.arc(sx, sy, R - 1, 0, TAU); p.stroke();
            // sceau
            const sz = small ? 34 : 44, kx = 22, ky = H - (small ? 170 : 110) - sz;
            p.fillStyle = '#b8261a'; p.fillRect(kx, ky, sz, sz);
            p.fillStyle = 'rgba(241,234,219,.95)'; p.font = `600 ${sz * .72}px ${SERIF}`; p.textAlign = 'center'; p.textBaseline = 'middle';
            p.fillText('鯉', kx + sz / 2, ky + sz / 2 + 1);
            // haïku en colonnes, de droite à gauche : « 池の鯉 / 春の光を / 泳ぎけり » (les carpes du bassin nagent dans la lumière du printemps)
            const fs = small ? 19 : 26, gap = fs * 1.35, cx0 = W - (small ? 26 : 44), cy0 = small ? H * .36 : H * .4;
            p.fillStyle = 'rgba(31,28,26,.78)'; p.font = `${fs}px ${SERIF}`;
            ['池の鯉', '春の光を', '泳ぎけり'].forEach((line, c) => [...line].forEach((ch, i) => p.fillText(ch, cx0 - c * gap, cy0 + i * fs * 1.08)));
            // petit sceau sous le poème
            const sgx = cx0 - 3 * gap - fs * .2, sgy = cy0 + fs * 2.2;
            const ss = fs * .78; p.fillStyle = '#b8261a'; p.fillRect(sgx - ss / 2, sgy + fs * 2.15, ss, ss);
            p.fillStyle = 'rgba(241,234,219,.95)'; p.font = `600 ${ss * .7}px ${SERIF}`; p.fillText('水', sgx, sgy + fs * 2.15 + ss / 2 + 1);

            // grain qui boit l'encre (technique « papier »)
            grain = document.createElement('canvas'); grain.width = paper.width; grain.height = paper.height;
            const gg = grain.getContext('2d'); gg.scale(d, d);
            for (let i = 0; i < W * H / 260; i++) {
                const x = Math.random() * W, y = Math.random() * H, an = Math.random() * TAU, l = rand(2, 14);
                gg.strokeStyle = `rgba(0,0,0,${rand(.15, .6)})`; gg.lineWidth = rand(.4, 1.2);
                gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); gg.stroke();
            }
            for (let i = 0; i < W * H / 120; i++) { gg.fillStyle = `rgba(0,0,0,${rand(.1, .5)})`; gg.fillRect(Math.random() * W, Math.random() * H, 1, 1); }

            // décor au-dessus de l'eau : on tire la géométrie une fois, puis on la peint à l'encre et en néon
            const pads = [], tries = small ? 3 : 4;
            for (let k = 0; k < 40 && pads.length < tries; k++) {
                const r = rand(small ? 20 : 28, small ? 34 : 50), x = rand(r + 20, W - r - 20), y = rand(H * .45, H - (small ? 190 : 130) - r);
                if (Math.hypot(x - sx, y - sy) < R + r + 20 || x > W - 200 || pads.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 30)) continue;
                pads.push({ x, y, r, notch: rand(0, TAU), edge: Array.from({ length: 28 }, () => rand(.9, 1.06)), arcs: Array.from({ length: 3 }, () => { const a0 = rand(.3, 4); return [a0, Math.min(a0 + rand(1, 2.2), TAU - .25), rand(.35, .6), rand(1.2, 2.6)]; }) });
            }
            const segs = [], blossoms = [];
            const branch = (x, y, an, len, w, depth) => {
                const n = 5, pts = [[x, y]];
                for (let i = 1; i <= n; i++) { an += rand(-.28, .28); const l = len / n; x += Math.cos(an) * l; y += Math.sin(an) * l; pts.push([x, y]); }
                for (let i = 0; i < n; i++) {
                    if (pts[i + 1][1] > H * .36) break;
                    const lw = w * (1 - i / n * .55);
                    segs.push({ a: pts[i], b: pts[i + 1], lw, depth, dash: [rand(3, 9), rand(2, 6)] });
                    if (depth < 2 && (Math.random() < .5 || (depth === 0 && i % 2))) branch(pts[i + 1][0], pts[i + 1][1], an + (Math.random() < .5 ? -1 : 1) * rand(.5, .9), len * rand(.35, .55), lw * .6, depth + 1);
                    if (Math.random() < (depth ? .5 : .35)) blossoms.push([pts[i + 1][0] + rand(-6, 6), pts[i + 1][1] + rand(-6, 6)]);
                }
                blossoms.push([x, y]);
            };
            branch(W + 10, small ? 20 : 30, Math.PI * .86, small ? W * .55 : Math.min(W * .32, 420), small ? 7 : 10, 0);
            const flowers = blossoms.map(([x, y]) => ({ x, y, r: rand(3.5, small ? 6 : 8), rot: rand(0, TAU), c: Array.from({ length: 5 }, () => [226 + rand(-10, 20) | 0, 96 + rand(-20, 30) | 0, 128 + rand(-15, 20) | 0, rand(.55, .8)]) }));
            S.blossoms = blossoms;
            // chaque nénuphar a sa propre image : il dérive doucement sur l'eau
            const paintPad = (pd, k, night) => {
                const { r, notch, edge, arcs } = pd, R2 = r * 1.2 + 16, x = 0, y = 0;
                const c = document.createElement('canvas'); c.width = c.height = Math.ceil(R2 * 2 * d);
                const q = c.getContext('2d'); q.scale(d, d); q.translate(R2, R2); q.lineCap = 'round';
                const glow = (col, b) => { q.shadowColor = night ? col : 'transparent'; q.shadowBlur = night ? b : 0; };
                    q.save(); q.rotate(notch);
                q.beginPath(); q.moveTo(0, 0); for (let i = 0; i <= 27; i++) { const an = .22 + i / 27 * (TAU - .44); q.lineTo(Math.cos(an) * r * edge[i], Math.sin(an) * r * edge[i]); } q.closePath();
                if (night) q.fillStyle = 'rgba(8,40,40,.55)';
                else { const gr = q.createRadialGradient(r * .35, r * .3, 0, 0, 0, r * 1.05); gr.addColorStop(0, 'rgba(120,132,98,.22)'); gr.addColorStop(.7, 'rgba(84,98,70,.34)'); gr.addColorStop(1, 'rgba(58,70,48,.5)'); q.fillStyle = gr; }
                q.fill();
                for (const [a0, a1, al, lw] of arcs) {
                    glow('#3dffb0', 10); q.strokeStyle = night ? `rgba(90,255,175,${al + .3})` : `rgba(40,48,34,${al})`; q.lineWidth = night ? lw * .8 : lw;
                    q.beginPath(); q.arc(0, 0, r * .97, a0, a1); q.stroke();
                }
                glow('#3dffb0', 4); q.strokeStyle = night ? 'rgba(90,255,175,.3)' : 'rgba(60,72,50,.28)'; q.lineWidth = .8;
                for (let v = 0; v < 6; v++) { const an = .5 + v * (TAU - 1) / 5; q.beginPath(); q.moveTo(0, 0); q.quadraticCurveTo(Math.cos(an + .1) * r * .5, Math.sin(an + .1) * r * .5, Math.cos(an) * r * .85, Math.sin(an) * r * .85); q.stroke(); }
                q.restore();
                if (k === 0) {
                    // une fleur de lotus posée sur la première feuille
                    glow('#ff6ec7', 12);
                    for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 7; i++) {
                        const an = i / 7 * TAU + ring * .45, l = r * (ring ? .38 : .55);
                        q.save(); q.translate(x + Math.cos(an) * l * .35, y + Math.sin(an) * l * .35); q.rotate(an + Math.PI / 2);
                        q.fillStyle = night ? (ring ? 'rgba(255,150,215,.75)' : 'rgba(255,90,190,.55)') : ring ? 'rgba(236,150,170,.85)' : 'rgba(226,120,148,.75)';
                        q.strokeStyle = night ? 'rgba(255,190,235,.9)' : 'rgba(170,60,90,.5)'; q.lineWidth = .7;
                        q.beginPath(); q.ellipse(0, 0, l * .28, l * .5, 0, 0, TAU); q.fill(); q.stroke(); q.restore();
                    }
                    glow('#ffd166', 10); q.fillStyle = night ? '#ffe08a' : 'rgba(230,190,70,.9)'; q.beginPath(); q.arc(x, y, r * .12, 0, TAU); q.fill();
                }
                return { c, R2 };
            };
            padSprites = { ink: pads.map((pd, k) => ({ ...pd, ...paintPad(pd, k, false), ph: rand(0, TAU) })) };
            padSprites.night = padSprites.ink.map((pd, k) => ({ ...pd, ...paintPad(pd, k, true) }));
            const paintBough = (night) => {
                const c = document.createElement('canvas'); c.width = paper.width; c.height = paper.height;
                const q = c.getContext('2d'); q.scale(d, d); q.lineCap = 'round';
                const glow = (col, b) => { q.shadowColor = night ? col : 'transparent'; q.shadowBlur = night ? b : 0; };
                for (const sg of segs) {
                    glow('rgba(255,140,210,.7)', 8);
                    q.strokeStyle = night ? `rgba(236,220,200,${.8 - sg.depth * .1})` : `rgba(32,27,24,${.82 - sg.depth * .1})`; q.lineWidth = night ? sg.lw * .55 : sg.lw;
                    q.beginPath(); q.moveTo(sg.a[0], sg.a[1]); q.lineTo(sg.b[0], sg.b[1]); q.stroke();
                    if (!night) {
                        q.strokeStyle = 'rgba(241,234,219,.35)'; q.lineWidth = Math.max(.6, sg.lw * .18); q.setLineDash(sg.dash);
                        q.beginPath(); q.moveTo(sg.a[0] + sg.lw * .2, sg.a[1]); q.lineTo(sg.b[0] + sg.lw * .2, sg.b[1]); q.stroke(); q.setLineDash([]);
                    }
                }
                for (const fl of flowers) {
                    glow('#ff5fbf', 10);
                    for (let k = 0; k < 5; k++) {
                        const an = fl.rot + k * TAU / 5, cc = fl.c[k];
                        q.fillStyle = night ? `rgba(255,${100 + (cc[1] - 96)},${190 + (cc[2] - 128)},${cc[3] + .1})` : `rgba(${cc[0]},${cc[1]},${cc[2]},${cc[3]})`;
                        q.beginPath(); q.arc(fl.x + Math.cos(an) * fl.r * .8, fl.y + Math.sin(an) * fl.r * .8, fl.r * .62, 0, TAU); q.fill();
                    }
                    q.fillStyle = night ? '#fff0fa' : 'rgba(160,30,40,.8)'; q.beginPath(); q.arc(fl.x, fl.y, fl.r * .25, 0, TAU); q.fill();
                }
                return c;
            };
            bough = paintBough(false); boughNight = paintBough(true);
            // soleil néon (sous l'eau, il passe derrière les poissons) et haïku lumineux
            sunNight = document.createElement('canvas'); sunNight.width = paper.width; sunNight.height = paper.height;
            {
                const q = sunNight.getContext('2d'); q.scale(d, d);
                const gr = q.createRadialGradient(sx, sy, 0, sx, sy, R);
                gr.addColorStop(0, 'rgba(255,70,120,.28)'); gr.addColorStop(1, 'rgba(255,40,100,.08)');
                q.fillStyle = gr; q.beginPath(); q.arc(sx, sy, R, 0, TAU); q.fill();
                q.save(); q.beginPath(); q.arc(sx, sy, R, 0, TAU); q.clip(); q.fillStyle = 'rgba(6,10,30,.9)';
                for (let i = 0; i < 6; i++) { const y = sy + R * (.15 + i * .15), h = 2 + i * 1.6; q.fillRect(sx - R, y, R * 2, h); }
                q.restore();
                q.shadowColor = '#ff3d7f'; q.shadowBlur = 26; q.strokeStyle = 'rgba(255,90,140,.95)'; q.lineWidth = 2.5;
                q.beginPath(); q.arc(sx, sy, R, 0, TAU); q.stroke();
            }
            haikuNight = document.createElement('canvas'); haikuNight.width = paper.width; haikuNight.height = paper.height;
            {
                const q = haikuNight.getContext('2d'); q.scale(d, d); q.textAlign = 'center'; q.textBaseline = 'middle';
                q.shadowColor = '#ff5fbf'; q.shadowBlur = 14; q.fillStyle = '#ffb3e1'; q.font = `${fs}px ${SERIF}`;
                ['池の鯉', '春の光を', '泳ぎけり'].forEach((line, c) => [...line].forEach((ch, i) => q.fillText(ch, cx0 - c * gap, cy0 + i * fs * 1.08)));
                q.shadowColor = '#ff3d7f'; q.strokeStyle = '#ff5f8f'; q.lineWidth = 1.5; q.strokeRect(sgx - ss / 2, sgy + fs * 2.15, ss, ss);
                q.fillStyle = '#ff9fbf'; q.font = `600 ${ss * .7}px ${SERIF}`; q.fillText('水', sgx, sgy + fs * 2.15 + ss / 2 + 1);
            }
            waves = Array.from({ length: small ? 4 : 7 }, () => ({ x: rand(0, W), y: rand(H * .1, H * .9), l: rand(30, 70), v: rand(-6, -2), p: rand(0, TAU) }));
        }

        // ---------- la vie du bassin ----------
        const puffSprites = new Map();
        function puffSprite(c) {
            const key = c.join(); if (puffSprites.has(key)) return puffSprites.get(key);
            const sp = document.createElement('canvas'); sp.width = sp.height = 64;
            const x = sp.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
            gr.addColorStop(0, ink(c, 1)); gr.addColorStop(.45, ink(c, .55)); gr.addColorStop(1, ink(c, 0));
            x.fillStyle = gr; x.fillRect(0, 0, 64, 64); puffSprites.set(key, sp); return sp;
        }
        let puffs = [], petals = [], waves = [], gulps = [], strokes = [], lastT = 0, nextPetal = 0, nextGulp = 5, nextDance = 12;
        function petal(g, x, y, rot, r, al) {
            g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha *= al;
            g.fillStyle = 'rgba(232,112,140,.85)'; g.beginPath(); g.moveTo(0, -r);
            g.quadraticCurveTo(r * 1.1, -r * .2, r * .25, r); g.lineTo(0, r * .7); g.lineTo(-r * .25, r); g.quadraticCurveTo(-r * 1.1, -r * .2, 0, -r); g.fill();
            g.restore();
        }
        function enso(r) {
            const k = (S.t - r.born) / 1.6, R = 8 + 60 * Math.sqrt(k), a0 = r.seed * TAU, sweep = TAU * .92 * Math.min(1, k * 4), segs = 48;
            ctx.lineCap = 'round';
            for (let i = 0; i < segs; i++) {
                const t = i / segs, an = a0 + t * TAU * .92; if (t * TAU * .92 > sweep) break;
                ctx.strokeStyle = `rgba(28,24,22,${(1 - k) * (.75 - t * .35)})`;
                ctx.lineWidth = Math.max(.4, 5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + .05)), .6) * (1 - k * .6));
                ctx.beginPath(); ctx.arc(r.x, r.y, R * (1 + Math.sin(t * 9 + r.seed * 5) * .02), an, an + TAU * .92 / segs + .02); ctx.stroke();
            }
        }
        // carpes qui montent et descendent, danse yin-yang, gobages en surface
        const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        function life(dt) {
            for (const f of S.fish) {
                if (!f.koi) f.koi = koiRobe(f);
                if (f.kind) continue;
                if (S.t > f.zNext && !f.dance) { f.zT = [0, .1, .4, .8][Math.random() * 4 | 0]; f.zNext = S.t + rand(8, 18); }
                if (f.dance) f.zT = 0;
                f.z += (f.zT - f.z) * Math.min(1, dt * .35);
            }
            if (S.t > nextDance && !S.food.length) {
                nextDance = S.t + rand(22, 35);
                // en calligraphie une rouge et une noire ; ailleurs deux poissons au hasard
                const ok = (f) => !f.dance && !f.kind && f.len > 80 && f.robe !== RARE;
                const calli = S.style === 'calli';
                const red = S.fish.filter((f) => ok(f) && (!calli || f.koi.base === 1 || f.koi.base === 0));
                const black = S.fish.filter((f) => ok(f) && (!calli || f.koi.base === 2));
                const a = red[Math.random() * red.length | 0], b = black.filter((f) => f !== a)[Math.random() * black.filter((f) => f !== a).length | 0];
                if (a && b) {
                    const cx = clamp((a.nodes[0].x + b.nodes[0].x) / 2, 160, S.W - 220), cy = clamp((a.nodes[0].y + b.nodes[0].y) / 2, 140, S.H - 200);
                    const R = clamp((a.len + b.len) * .28, 50, 90), dir = Math.random() < .5 ? 1 : -1, t0 = S.t, end = S.t + 13;
                    a.dance = { cx, cy, R, dir, t0, end, off: 0 }; b.dance = { cx, cy, R, dir, t0, end, off: Math.PI };
                }
            }
            if (S.t > nextGulp) {
                nextGulp = S.t + rand(3, 6);
                const up = S.fish.filter((f) => f.koi && !f.kind && f.z < .15);
                if (up.length) { const f = up[Math.random() * up.length | 0], h = f.nodes[0]; gulps.push({ x: h.x + Math.cos(f.h) * f.w, y: h.y + Math.sin(f.h) * f.w, born: S.t }); }
            }
            for (const w of waves) { w.x += w.v * dt; if (w.x < -w.l) { w.x = S.W + w.l; w.y = rand(S.H * .1, S.H * .9); } }
            gulps = gulps.filter((gp) => S.t - gp.born < 2.6);
            // traînées : bouffées d'encre (ou de lumière) le long du corps
            for (const f of S.fish) {
                if (f.kind || S.t - (f.puffT || 0) < .12) continue;
                f.puffT = S.t;
                const n = f.nodes[9];
                puffs.push({ x: n.x + rand(-3, 3), y: n.y + rand(-3, 3), r: f.w * rand(.5, .8), born: S.t, dx: rand(-4, 4), dy: rand(-4, 4), z: f.z,
                    c1: f.koi.base === 0 ? [110, 104, 96] : INKC[f.koi.base], c2: hexRgb(f.robe[0]) });
            }
            puffs = puffs.filter((q) => S.t - q.born < 2.6);
            // pétales : ils tombent de la branche, touchent l'eau puis dérivent
            if (S.blossoms && S.blossoms.length && S.t > nextPetal && petals.length < 16) {
                nextPetal = S.t + rand(.6, 1.6);
                const [bx, by] = S.blossoms[Math.random() * S.blossoms.length | 0];
                petals.push({ x: bx, y: by, land: Math.min(S.H - 40, by + rand(120, S.H * .7)), air: true, rot: rand(0, TAU), vr: rand(-2, 2), r: rand(3.5, 5.5), born: S.t, sway: rand(0, TAU), life: rand(14, 22) });
            }
            for (const q of petals) {
                if (q.air) {
                    q.y += dt * 34; q.x += Math.sin(S.t * 1.6 + q.sway) * dt * 30 - dt * 10; q.rot += q.vr * dt;
                    if (q.y >= q.land) { q.air = false; q.wet = S.t; }
                } else { q.x -= dt * 6; q.y += Math.sin(S.t * .5 + q.sway) * dt * 3; q.rot += q.vr * dt * .1; }
            }
            petals = petals.filter((q) => S.t - q.born < q.life && q.x > -20);
            strokes = strokes.filter((st) => st.down || (st.pts.length && S.t - st.pts[st.pts.length - 1].t < 5));
        }
        const fade = (q) => Math.min(1, (q.life - (S.t - q.born)) / 3);
        // ---------- néon : la même vie, en lumière ----------
        const CYAN = [46, 242, 255];
        function neonScene(vis) {
            ensureScene();
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = vis * .9; ctx.drawImage(sunNight, 0, 0, S.W, S.H);
            for (const q of puffs) {
                const k = (S.t - q.born) / 2.6, r = q.r * (1 + k * 2.6);
                ctx.globalAlpha = vis * .13 * (1 - q.z * .5) * Math.pow(1 - k, 1.6) * Math.min(1, k * 8);
                ctx.drawImage(puffSprite(q.c2), q.x + q.dx * k - r, q.y + q.dy * k - r, r * 2, r * 2);
            }
            // trait de lumière peint dans l'eau
            const sp = puffSprite(CYAN); ctx.lineCap = ctx.lineJoin = 'round';
            for (const st of strokes) {
                const pts = st.pts;
                for (let i = 0; i < pts.length; i += 2) {
                    const b = pts[i], age = S.t - b.t; if (age > 5) continue;
                    const r = b.w * 2 + age * 9; ctx.globalAlpha = vis * .22 * Math.pow(1 - age / 5, 1.4); ctx.drawImage(sp, b.x - r, b.y - r, r * 2, r * 2);
                }
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i], age = S.t - b.t; if (age > 5) continue;
                    const al = vis * Math.pow(1 - age / 5, 2);
                    ctx.globalAlpha = al * .5; ctx.strokeStyle = '#b26bff'; ctx.lineWidth = b.w * 1.6 + age * 2;
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                    ctx.globalAlpha = al; ctx.strokeStyle = '#e8fdff'; ctx.lineWidth = Math.max(1, b.w * .45);
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
            ctx.restore();
            depthLayers(vis, false, 'lighter');
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
            for (const w of waves) {
                ctx.globalAlpha = vis * .22; ctx.strokeStyle = '#2ef2ff'; ctx.lineWidth = 1.2; ctx.beginPath();
                for (let i = 0; i <= 12; i++) { const t = i / 12, x = w.x + t * w.l, y = w.y + Math.sin(t * TAU * 1.5 + S.t * 1.2 + w.p) * 2.5; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
                ctx.stroke();
            }
            for (const gp of gulps) {
                const k = (S.t - gp.born) / 2.6;
                for (let j = 0; j < 3; j++) {
                    const kk = k - j * .12; if (kk <= 0) continue;
                    ctx.globalAlpha = vis * (1 - kk) * .6; ctx.strokeStyle = j ? '#b26bff' : '#2ef2ff'; ctx.lineWidth = 1.3;
                    ctx.beginPath(); ctx.ellipse(gp.x, gp.y, 3 + kk * 34, (3 + kk * 34) * .72, 0, 0, TAU); ctx.stroke();
                }
            }
            for (const q of petals) if (!q.air) { ctx.globalAlpha = vis; neonPetal(q, fade(q)); }
            ctx.restore();
            ctx.save(); ctx.globalAlpha = vis; drawPads(ctx, true); ctx.drawImage(boughNight, 0, 0, S.W, S.H);
            ctx.globalCompositeOperation = 'lighter';
            for (const q of petals) if (q.air) neonPetal(q, fade(q));
            ctx.drawImage(haikuNight, 0, 0, S.W, S.H);
            ctx.restore();
        }
        function neonPetal(q, al) {
            ctx.save(); ctx.shadowColor = '#ff5fbf'; ctx.shadowBlur = 8; petal(ctx, q.x, q.y, q.rot, q.r, al);
            ctx.restore();
        }
        // carpes en trois plans : le fond flou et pâle, la surface nette
        function depthLayers(vis, mask, op) {
            const Wd = Math.round(S.W * S.dpr), Hd = Math.round(S.H * S.dpr);
            for (const L of layers) { if (L.c.width !== Wd || L.c.height !== Hd) { L.c.width = Wd; L.c.height = Hd; } L.g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0); L.g.clearRect(0, 0, S.W, S.H); L.n = 0; }
            for (const f of [...S.sorted].sort((a, b) => (b.z || 0) - (a.z || 0))) {
                const k = (f.z || 0) > .55 ? 0 : (f.z || 0) > .22 ? 1 : 2;
                drawFish(f, vis * (1 - (f.z || 0) * .45), layers[k].g, mask); layers[k].n++;
            }
            layers.forEach((L, k) => {
                if (!L.n) return;
                if (mask === 'calli' && S.tech === 'papier') {
                    L.g.save(); L.g.setTransform(1, 0, 0, 1, 0, 0); L.g.globalCompositeOperation = 'destination-out'; L.g.globalAlpha = .8; L.g.drawImage(grain, 0, 0); L.g.restore();
                }
                if ((mask === 'calli' && S.tech === 'sumie') || mask === 'aqua') {
                    // l'encre file dans l'eau autour de la carpe
                    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${(k === 2 ? 5 : 8) * S.dpr}px)`; ctx.globalAlpha = .55; ctx.drawImage(L.c, 0, 0); ctx.restore();
                }
                ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.filter = k === 0 ? `blur(${2.6 * S.dpr}px) saturate(.55)` : k === 1 ? `blur(${1.1 * S.dpr}px) saturate(.8)` : 'none';
                if (op) ctx.globalCompositeOperation = op;
                ctx.drawImage(L.c, 0, 0); ctx.restore();
            });
        }
        // ---------- ASCII et code : tout le décor passe dans la silhouette lue case par case ----------
        function decorMask(g, vis, under) {
            if (under) { g.globalAlpha = vis; g.drawImage(sunNight, 0, 0, S.W, S.H); return; }
            g.save(); g.globalCompositeOperation = 'source-over';
            for (const q of puffs) {
                const k = (S.t - q.born) / 2.6, r = q.r * (1 + k * 2);
                g.globalAlpha = vis * .45 * (1 - q.z * .5) * Math.pow(1 - k, 1.4) * Math.min(1, k * 8);
                g.drawImage(puffSprite(q.c2), q.x + q.dx * k - r, q.y + q.dy * k - r, r * 2, r * 2);
            }
            g.lineCap = g.lineJoin = 'round';
            for (const st of strokes) {
                const pts = st.pts;
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i], age = S.t - b.t; if (age > 5) continue;
                    g.globalAlpha = vis * Math.pow(1 - age / 5, 1.5); g.strokeStyle = age < 1.5 ? '#e8fdff' : '#2ef2ff'; g.lineWidth = b.w * 1.6 + age * 6;
                    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
                }
            }
            for (const w of waves) {
                g.globalAlpha = vis * .45; g.strokeStyle = '#2ef2ff'; g.lineWidth = 4; g.beginPath();
                for (let i = 0; i <= 12; i++) { const t = i / 12, x = w.x + t * w.l, y = w.y + Math.sin(t * TAU * 1.5 + S.t * 1.2 + w.p) * 4; i ? g.lineTo(x, y) : g.moveTo(x, y); }
                g.stroke();
            }
            for (const gp of gulps) {
                const k = (S.t - gp.born) / 2.6;
                g.globalAlpha = vis * (1 - k) * .8; g.strokeStyle = '#2ef2ff'; g.lineWidth = 5;
                g.beginPath(); g.ellipse(gp.x, gp.y, 6 + k * 40, (6 + k * 40) * .72, 0, 0, TAU); g.stroke();
            }
            g.globalAlpha = vis; drawPads(g, true); g.drawImage(boughNight, 0, 0, S.W, S.H);
            for (const q of petals) { g.globalAlpha = vis * fade(q); g.fillStyle = '#ff7ac8'; g.beginPath(); g.arc(q.x, q.y, 7, 0, TAU); g.fill(); }
            g.restore();
        }
        // trait d'encre peint dans l'eau : épais quand on va lentement, puis il se dilue
        function drawStrokes() {
            const sp = puffSprite([24, 21, 20]);
            ctx.lineCap = ctx.lineJoin = 'round';
            for (const st of strokes) {
                const pts = st.pts;
                // l'encre diffuse : un nuage qui grandit autour du trait
                for (let i = 0; i < pts.length; i += 2) {
                    const b = pts[i], age = S.t - b.t; if (age > 5) continue;
                    const k = age / 5, r = b.w * 1.5 + age * 9;
                    ctx.globalAlpha = .16 * Math.pow(1 - k, 1.4); ctx.drawImage(sp, b.x - r, b.y - r, r * 2, r * 2);
                }
                ctx.globalAlpha = 1;
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i], age = S.t - b.t; if (age > 5) continue;
                    ctx.strokeStyle = `rgba(24,21,20,${.85 * Math.pow(1 - age / 5, 2)})`; ctx.lineWidth = b.w * (1 + age * .35);
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                }
            }
            strokes = strokes.filter((st) => st.down || (st.pts.length && S.t - st.pts[st.pts.length - 1].t < 5));
        }
        const layers = [0, 1, 2].map(() => { const c = document.createElement('canvas'); return { c, g: c.getContext('2d'), n: 0 }; });
        function ensureScene() { if (!paper || paper.width !== Math.round(S.W * S.dpr) || paper.height !== Math.round(S.H * S.dpr)) makePaper(); }
        function drawCalliScene(vis) {
            ensureScene();
            ctx.save(); ctx.globalAlpha = vis; ctx.drawImage(paper, 0, 0, S.W, S.H);
            for (const q of puffs) {
                const k = (S.t - q.born) / 2.6, r = q.r * (1 + k * 2.6);
                ctx.globalAlpha = vis * .1 * (1 - q.z * .5) * Math.pow(1 - k, 1.6) * Math.min(1, k * 8);
                ctx.drawImage(puffSprite(q.c1), q.x + q.dx * k - r, q.y + q.dy * k - r, r * 2, r * 2);
            }
            ctx.globalAlpha = vis;
            for (const p of S.food) {
                const age = S.t - p.born, fade = age > 9 ? 1 - (age - 9) / 3 : 1, sp = 3 + Math.min(age, 6) * 1.4;
                const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sp);
                gr.addColorStop(0, `rgba(20,18,18,${.85 * fade})`); gr.addColorStop(.35, `rgba(20,18,18,${.35 * fade})`); gr.addColorStop(1, 'rgba(20,18,18,0)');
                ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(p.x, p.y, sp, 0, TAU); ctx.fill();
            }
            drawPellets(ctx, vis, 'calli');
            for (const r of S.rings) {
                if (r.seed == null) r.seed = Math.random();
                if (!r.blob) r.blob = Array.from({ length: 22 }, () => rand(.7, 1.25));
                const k = (S.t - r.born) / 1.6, R = 5 + 20 * Math.sqrt(Math.min(1, k * 2.5)), n = r.blob.length;
                const gr = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, R * 1.25);
                gr.addColorStop(0, `rgba(22,19,18,${.55 * (1 - k)})`); gr.addColorStop(.75, `rgba(22,19,18,${.4 * (1 - k)})`); gr.addColorStop(1, `rgba(22,19,18,${.6 * (1 - k)})`);
                ctx.fillStyle = gr; ctx.beginPath();
                for (let i = 0; i <= n; i++) { const an = i / n * TAU, rr = R * r.blob[i % n]; i ? ctx.lineTo(r.x + Math.cos(an) * rr, r.y + Math.sin(an) * rr) : ctx.moveTo(r.x + Math.cos(an) * rr, r.y + Math.sin(an) * rr); }
                ctx.fill();
                enso(r);
            }
            drawStrokes();
            ctx.restore();

            depthLayers(vis, 'calli', S.tech === 'papier' ? 'multiply' : null);

            // surface : ondes au pinceau, gobages, pétales qui flottent
            ctx.save(); ctx.globalAlpha = vis; ctx.lineCap = 'round';
            for (const w of waves) {
                ctx.strokeStyle = 'rgba(60,54,48,.16)'; ctx.lineWidth = 1.2; ctx.beginPath();
                for (let i = 0; i <= 12; i++) { const t = i / 12, x = w.x + t * w.l, y = w.y + Math.sin(t * TAU * 1.5 + S.t * 1.2 + w.p) * 2.5; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
                ctx.stroke();
            }
            for (const gp of gulps) {
                const k = (S.t - gp.born) / 2.6;
                for (let j = 0; j < 3; j++) {
                    const kk = k - j * .12; if (kk <= 0) continue;
                    ctx.strokeStyle = `rgba(40,34,30,${(1 - kk) * .45})`; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.ellipse(gp.x, gp.y, 3 + kk * 34, (3 + kk * 34) * .72, 0, 0, TAU); ctx.stroke();
                }
                if (k < .4) { ctx.fillStyle = `rgba(40,34,30,${.5 - k})`; for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.arc(gp.x + Math.cos(j * 2.1) * 5, gp.y + Math.sin(j * 2.1) * 4, 1.3, 0, TAU); ctx.fill(); } }
            }
            for (const q of petals) {
                if (q.air) continue;
                const k = (S.t - q.wet) / 2, al = Math.min(1, (q.life - (S.t - q.born)) / 3);
                if (k < 1) { ctx.strokeStyle = `rgba(40,34,30,${(1 - k) * .3})`; ctx.lineWidth = .8; ctx.beginPath(); ctx.ellipse(q.x, q.y, 4 + k * 22, (4 + k * 22) * .7, 0, 0, TAU); ctx.stroke(); }
                ctx.fillStyle = 'rgba(80,60,40,.08)'; ctx.beginPath(); ctx.ellipse(q.x + 2, q.y + 3, q.r, q.r * .7, q.rot, 0, TAU); ctx.fill();
                petal(ctx, q.x, q.y, q.rot, q.r * .95, al);
            }
            drawPads(ctx, false); ctx.drawImage(bough, 0, 0, S.W, S.H);
            for (const q of petals) if (q.air) petal(ctx, q.x, q.y, q.rot, q.r, Math.min(1, (q.life - (S.t - q.born)) / 3));
            ctx.restore();
        }
        // appui long ou glisser : peindre dans l'eau ; les carpes viennent voir
        function onPaintDown(e) {
            if (!opts.decor || e.target !== cv || !['neon', 'ascii', 'code', 'calli'].includes(S.style)) return;
            const st = { pts: [], down: true, x0: e.clientX, y0: e.clientY, lt: e.timeStamp };
            st.pts.push({ x: e.clientX, y: e.clientY, t: S.t, w: 6 });
            strokes.push(st); S.painting = st;
        }
        function onPaintMove(e) {
            const st = S.painting; if (!st || !st.down) return;
            const last = st.pts[st.pts.length - 1], d = Math.hypot(e.clientX - last.x, e.clientY - last.y);
            if (d < 4) return;
            const v = d / Math.max(1, e.timeStamp - st.lt) * 1000; st.lt = e.timeStamp;
            st.pts.push({ x: e.clientX, y: e.clientY, t: S.t, w: clamp(10 - v * .008, 1.5, 10) });
            if (Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 10) S.drew = true;
            S.lure = { x: e.clientX, y: e.clientY, t: S.t };
        }
        function onPaintUp() {
            const st = S.painting; if (!st) return;
            st.down = false; S.painting = null;
            if (st.pts.length < 2) strokes = strokes.filter((x) => x !== st);
        }

        // Bande de transformation : un balayage de caractères qui change le rendu au passage
        function drawBand(x, vis) {
            const { cw, ch, rows } = grid;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.font = (ch - 2) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (let k = -2; k <= 1; k++) {
                for (let row = 0; row < rows; row++) {
                    if (Math.random() < .35) continue;
                    ctx.globalAlpha = (k === 0 ? .9 : .35) * vis;
                    ctx.fillStyle = k === 0 ? '#e8fdff' : row % 3 ? '#2ef2ff' : '#b26bff';
                    ctx.fillText(KATA[Math.random() * KATA.length | 0], x + k * cw, row * ch + ch / 2);
                }
            }
            ctx.globalAlpha = .7 * vis; ctx.fillStyle = '#2ef2ff'; ctx.fillRect(x, 0, 1.5, S.H);
            ctx.restore();
        }

        // rides du souffle : encre sur les fonds clairs, lumière ailleurs
        function drawWind(vis) {
            if (!S.ripples.length && !S.gusts.length) return;
            const light = LIGHT.includes(S.style);
            ctx.save();
            ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
            ctx.strokeStyle = light ? 'rgb(40,34,30)' : S.style === 'abysses' ? '#3dffb0' : '#9ff6ff';
            for (const r of S.ripples) {
                const k = (S.t - r.born) / r.life;
                for (let j = 0; j < 3; j++) {
                    const kk = k - j * .14; if (kk <= 0) continue;
                    const rr = 4 + kk * 90 * r.s;
                    ctx.globalAlpha = (1 - kk) * (light ? .35 : .45) * vis; ctx.lineWidth = (1.6 - j * .4) * (1 - kk * .5);
                    ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * .72, 0, 0, TAU); ctx.stroke();
                }
            }
            for (const q of S.gusts) {
                const k = (S.t - q.born) / q.life, d = q.d0 + (S.t - q.born) * q.v;
                ctx.globalAlpha = Math.sin(Math.PI * k) * (light ? .3 : .4) * vis; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.ellipse(q.x, q.y, d, d * .75, 0, q.an - q.w, q.an + q.w); ctx.stroke();
            }
            ctx.restore();
        }

        function render() {
            const { W, H, dpr } = S, vis = S.vis;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            if (vis < .01) return;
            S.frame++;
            ctx.save(); ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = '#7fe9ff'; ctx.lineWidth = 1;
            for (const b of S.bubbles) { ctx.globalAlpha = .18 * vis; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke(); }
            for (const r of S.rings) {
                const k = (S.t - r.born) / 1.6, rr = 6 + k * 70 * r.s;
                ctx.globalAlpha = (1 - k) * .55 * vis * r.s; ctx.strokeStyle = '#2ef2ff'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.ellipse(r.x, r.y, rr, rr * .7, 0, 0, TAU); ctx.stroke();
            }
            ctx.restore();
            drawPellets(ctx, vis, 'nuit');
            S.sorted = [...S.fish].sort((a, b) => a.depth - b.depth);
            if (opts.decor) { ensureScene(); life(Math.min(.1, Math.max(0, S.t - lastT))); lastT = S.t; }
            const tr = S.trans;
            if (tr < 1) {
                const e = tr < .5 ? 2 * tr * tr : 1 - Math.pow(-2 * tr + 2, 2) / 2, x = e * (W + 80) - 40;
                ctx.save(); ctx.beginPath(); ctx.rect(x, 0, W - x, H); ctx.clip(); drawStyle(S.prev, vis); ctx.restore();
                ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, x), H); ctx.clip(); drawStyle(S.style, vis); ctx.restore();
                drawBand(x, vis);
            } else drawStyle(S.style, vis);
            drawWind(vis);
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 2;
            for (const s of S.sparks) {
                const k = (S.t - s.born) / .5; ctx.strokeStyle = s.c; ctx.globalAlpha = (1 - k) * vis;
                ctx.beginPath(); ctx.arc(s.x, s.y, 4 + k * 16, 0, TAU); ctx.stroke();
            }
            ctx.restore();
        }

        // ---------- boucle ----------
        let raf = 0, last = 0, acc = 0, n = 0, dead = false;
        function frame(now) {
            const dt = Math.min(.1, (now - last) / 1000); last = now; acc += dt;
            let k = 0; while (acc >= 1 / 60 && k < 4) { step(1 / 60); acc -= 1 / 60; k++; } if (k === 4) acc = 0;
            S.vis += (S.visTarget - S.vis) * Math.min(1, dt * 3);
            S.trans = Math.min(1, S.trans + dt / 1.1);
            if (S.auto && (S.autoT += dt) > 7) { S.autoT = 0; setStyle(STYLES[(STYLES.indexOf(S.style) + 1) % STYLES.length], true); }
            if (++n % 30 === 0) measure();
            render();
            raf = requestAnimationFrame(frame);
        }
        // Animations réduites : les poissons se dispersent, puis une seule image fixe
        function still() { if (S.t < 4) for (let i = 0; i < 240; i++) step(1 / 60); S.vis = S.visTarget; S.trans = 1; measure(); render(); }
        function start() {
            cancelAnimationFrame(raf);
            if (dead) return;
            if (reduce.matches || document.hidden) { if (reduce.matches) still(); return; }
            last = performance.now(); raf = requestAnimationFrame(frame);
        }

        function setStyle(s, keepAuto) {
            if (STYLES.indexOf(s) < 0 || s === S.style) return;
            if (!keepAuto) S.auto = false;
            S.prev = S.style; S.style = s; S.trans = reduce.matches ? 1 : 0;
            stats();
            if (reduce.matches) still();
        }

        // ---------- interactions ----------
        const onResize = () => { resize(); if (reduce.matches) still(); };
        const onMove = (e) => {
            const el = Math.max(1, e.timeStamp - ptr.lt) / 1000, sp = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) / el;
            ptr.speed += (Math.min(sp, 5000) - ptr.speed) * .5; ptr.lt = e.timeStamp;
            ptr.x = e.clientX; ptr.y = e.clientY; ptr.active = e.pointerType !== 'touch';
        };
        const onLeave = () => { ptr.active = false; };
        // Un clic dans l'eau (hors liens, boutons et texte sélectionné) jette des granulés
        const onClick = (e) => {
            if (S.drew) { S.drew = false; return; }
            if (reduce.matches || S.vis < .3) return;
            if (e.composedPath().some((el) => el instanceof Element && el.matches('a, button, input, textarea, select, label, [role="button"], [data-bassin-ignore]'))) return;
            if (String(getSelection() || '')) return;
            feed(e.clientX, e.clientY);
        };
        const onVis = () => start();
        addEventListener('resize', onResize);
        addEventListener('scroll', measure, { passive: true });
        addEventListener('pointermove', onMove, { passive: true });
        addEventListener('pointerdown', onPaintDown);
        addEventListener('pointermove', onPaintMove, { passive: true });
        addEventListener('pointerup', onPaintUp);
        addEventListener('pointercancel', onPaintUp);
        if (!opts.passage) addEventListener('click', onClick);
        document.documentElement.addEventListener('pointerleave', onLeave);
        document.addEventListener('visibilitychange', onVis);
        reduce.addEventListener('change', start);

        if (document.fonts) document.fonts.load('14px "Share Tech Mono"').catch(() => {});
        resize();
        start();

        return {
            styles: STYLES.slice(),
            setStyle: (s) => setStyle(s),
            setAuto(on) { S.auto = !!on; S.autoT = 0; if (on) setStyle(STYLES[(STYLES.indexOf(S.style) + 1) % STYLES.length], true); stats(); },
            setSpeed(v) { S.spd = clamp(+v || 1, .2, 3); },
            setTech(t) { S.tech = t; if (reduce.matches) still(); },
            get tech() { return S.tech; },
            setVis(v) { S.visTarget = v; if (reduce.matches) still(); },
            // niveau 0..1 (micro) ; le souffle part du pointeur s'il est sur l'eau, sinon du centre
            souffle(v) {
                const wd = S.wind, l = clamp(+v || 0, 0, 1);
                wd.level += (l - wd.level) * (l > wd.level ? .5 : .15);
                if (wd.level < .12) return;
                const [x, y] = ptr.active && ptr.x > 0 ? [ptr.x, ptr.y] : [S.W / 2, S.H * .5];
                wd.x += (x - wd.x) * (wd.x ? .2 : 1); wd.y += (y - wd.y) * (wd.y ? .2 : 1);
            },
            visite: (k) => visit(k),
            get style() { return S.style; },
            get auto() { return S.auto; },
            destroy() {
                dead = true;
                cancelAnimationFrame(raf);
                removeEventListener('resize', onResize);
                removeEventListener('scroll', measure);
                removeEventListener('pointermove', onMove);
                removeEventListener('pointerdown', onPaintDown);
                removeEventListener('pointermove', onPaintMove);
                removeEventListener('pointerup', onPaintUp);
                removeEventListener('pointercancel', onPaintUp);
                removeEventListener('click', onClick);
                document.documentElement.removeEventListener('pointerleave', onLeave);
                document.removeEventListener('visibilitychange', onVis);
                reduce.removeEventListener('change', start);
            },
        };
    }

    window.MVBassin = { create, STYLES };
})();
