/* global window */

(function () {
  function clamp(x, lo, hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function isSmallKana(ch) {
    return /[ゃゅょぁぃぅぇぉャュョァィゥェォ]/.test(ch);
  }

  function isKana(ch) {
    return /[ぁ-ゖァ-ヺー]/.test(ch);
  }

  function splitToMoras(text) {
    const s = String(text || '');
    const out = [];
    let cur = '';
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (!isKana(ch)) {
        // Non-kana: treat as a mora-ish unit if it's not whitespace.
        if (cur) {
          out.push(cur);
          cur = '';
        }
        if (!/\s/.test(ch)) out.push(ch);
        continue;
      }

      // Long vowel mark extends previous mora.
      if (ch === 'ー') {
        if (cur) cur += ch;
        else if (out.length) out[out.length - 1] += ch;
        continue;
      }

      // Small tsu (促音) attaches to next; treat as its own mora for timing.
      if (ch === 'っ' || ch === 'ッ') {
        if (cur) {
          out.push(cur);
          cur = '';
        }
        out.push(ch);
        continue;
      }

      // Small kana attaches to previous kana (e.g., きゃ)
      if (isSmallKana(ch)) {
        if (cur) {
          cur += ch;
        } else if (out.length) {
          out[out.length - 1] += ch;
        } else {
          out.push(ch);
        }
        continue;
      }

      if (cur) out.push(cur);
      cur = ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function vowelOfKana(mora) {
    const m = String(mora || '');
    // Order matters: check i/u/e/o before a for combined patterns.
    // This is a heuristic that works well enough for mouth shaping.
    if (/[いきぎしじちぢにひびぴみりゐイキギシジチヂニヒビピミリヰ]/.test(m)) return 'i';
    if (/[うくぐすずつづぬふぶぷむゆるゔウクグスズツヅヌフブプムユルヴ]/.test(m)) return 'u';
    if (/[えけげせぜてでねへべぺめれゑエケゲセゼテデネヘベペメレヱ]/.test(m)) return 'e';
    if (/[おこごそぞとどのほぼぽもよろをオコゴソゾトドノホボポモヨロヲ]/.test(m)) return 'o';
    if (/[あかがさざたぢだなはばぱまやらわぁゃゎアカガサザタダナハバパマヤラワァャヮ]/.test(m)) return 'a';
    if (/[んン]/.test(m)) return null;
    return null;
  }

  function buildTextLipSyncCurve(text, opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const fps = Number(o.fps || 60) || 60;
    const moraMs = Number(o.moraMs || 120) || 120;
    const minOpen = Number(o.minOpen || 0.15); // keep visible movement
    const maxOpen = Number(o.maxOpen || 0.85);

    const moras = splitToMoras(text);
    const durationMs = Math.max(0, moras.length * moraMs);
    const dt = 1000 / fps;
    const n = Math.max(1, Math.ceil(durationMs / dt));

    const mouthOpen = new Array(n);
    const a = new Array(n);
    const i = new Array(n);
    const u = new Array(n);
    const e = new Array(n);
    const oo = new Array(n);

    function tri01(p) {
      // 0..1 -> 0..1..0
      const x = clamp(p, 0, 1);
      return x < 0.5 ? x * 2 : (1 - x) * 2;
    }

    for (let k = 0; k < n; k += 1) {
      const t = k * dt;
      const idx = Math.min(moras.length - 1, Math.floor(t / moraMs));
      const local = (t - idx * moraMs) / moraMs;
      const pulse = tri01(local);
      const open = minOpen + (maxOpen - minOpen) * pulse;

      const v = idx >= 0 ? vowelOfKana(moras[idx]) : null;
      mouthOpen[k] = open;
      a[k] = v === 'a' ? open : 0;
      i[k] = v === 'i' ? open : 0;
      u[k] = v === 'u' ? open : 0;
      e[k] = v === 'e' ? open : 0;
      oo[k] = v === 'o' ? open : 0;
    }

    return {
      fps,
      duration_ms: durationMs,
      series: {
        mouth_open: mouthOpen,
        mouth_form: new Array(n).fill(0),
        smile: new Array(n).fill(0),
        vowel_a: a,
        vowel_i: i,
        vowel_u: u,
        vowel_e: e,
        vowel_o: oo,
      },
      meta: {
        type: 'text_mora_heuristic',
        mora_ms: moraMs,
        text: String(text || ''),
      },
    };
  }

  window.AITuberTextLipSync = {
    splitToMoras,
    vowelOfKana,
    buildTextLipSyncCurve,
  };
})();
