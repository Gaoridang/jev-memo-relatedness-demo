(function () {
  const TOKEN_RE = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*|[가-힣]+/g;
  const DOC_CODE_RE = /^[A-Za-z]{1,6}\d{1,6}$/;
  const IDENT_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
  const ACRONYM_RE = /^[A-Z]{2,12}$/;
  const STOP = new Set(
    "gate yes no user await the and for with from this that not but are was were have has had will just only into over then than them they your ours http https www com org app api".split(
      " "
    )
  );
  const PARTICLES = [
    "에서는",
    "이라는",
    "한테",
    "부터",
    "까지",
    "으로",
    "에서",
    "라는",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "의",
    "도",
    "만",
    "과",
    "와",
    "로",
    "에",
  ];
  const PLACE_SUFFIXES = ["대학교", "회관", "빌딩", "타워", "공항", "대학", "나라", "산", "역", "대"];
  const SAN_DENY = new Set(["중국", "국내", "수입", "국", "일본", "미국", "한국", "유럽"]);
  const DOUBLE_SURNAMES = new Set(["남궁", "선우", "제갈", "사공", "독고", "황보"]);
  const SURNAMES = new Set(
    "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반라왕금옥육인맹제모".split(
      ""
    )
  );
  const PERSON_BLOCK = new Set(
    "이어서 이래서 이런데 하지만 하여금 하면서 하였고 하면은 이러한 이것은".split(" ")
  );
  const PERSON_END = new Set("실 권 표 님 적 용 세 액 중 식".split(" "));
  const HONORIFICS = ["선생", "교수", "팀장", "대리", "과장", "부장", "실장", "책임", "님", "씨"];

  function phraseKey(surface, kind) {
    if (kind === "latin") return surface.toLowerCase();
    return surface;
  }

  function scanTokens(text) {
    const tokens = [];
    TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_RE.exec(text)) !== null) {
      const start = match.index;
      const surface = match[0];
      const prev = start > 0 ? text.charAt(start - 1) : "";
      const hangul = surface.charAt(0) >= "가" && surface.charAt(0) <= "힣";
      if (hangul) {
        if (prev >= "가" && prev <= "힣") continue;
      } else if (/[A-Za-z0-9_]/.test(prev)) {
        continue;
      }
      tokens.push({
        surface,
        start,
        end: start + surface.length,
        hangul,
      });
    }
    return tokens;
  }

  function assignLines(text, tokens) {
    const hangulOnLine = [];
    let line = 0;
    let cursor = 0;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      while (cursor < token.start) {
        if (text.charAt(cursor) === "\n") line += 1;
        cursor += 1;
      }
      token.line = line;
      token.index = i;
      if (token.hangul) {
        if (!hangulOnLine[line]) hangulOnLine[line] = [];
        hangulOnLine[line].push(token);
      }
    }
    return hangulOnLine;
  }

  function hangulStem(surface) {
    for (let i = 0; i < PARTICLES.length; i += 1) {
      const particle = PARTICLES[i];
      if (surface.endsWith(particle) && surface.length - particle.length >= 2) {
        return surface.slice(0, surface.length - particle.length);
      }
    }
    return surface;
  }

  function isPlace(stem) {
    if (stem.length < 3 || stem === "우리나라") return false;
    let suffix = "";
    for (let i = 0; i < PLACE_SUFFIXES.length; i += 1) {
      if (stem.endsWith(PLACE_SUFFIXES[i])) {
        suffix = PLACE_SUFFIXES[i];
        break;
      }
    }
    if (!suffix) return false;
    const head = stem.slice(0, stem.length - suffix.length);
    if (head.length < 2) return false;
    if (suffix === "산" && SAN_DENY.has(head)) return false;
    return true;
  }

  function personShape(stem) {
    if (PERSON_BLOCK.has(stem)) return false;
    if (PERSON_END.has(stem.charAt(stem.length - 1))) return false;
    if (stem.length === 3 && SURNAMES.has(stem.charAt(0))) return true;
    if (
      (stem.length === 3 || stem.length === 4) &&
      DOUBLE_SURNAMES.has(stem.slice(0, 2))
    ) {
      return true;
    }
    return false;
  }

  function isHonorificCue(surface) {
    const stem = hangulStem(surface);
    if (surface === "선생님" || stem === "선생님") return true;
    for (let i = 0; i < HONORIFICS.length; i += 1) {
      const honorific = HONORIFICS[i];
      if (surface === honorific || stem === honorific) return true;
      if (honorific.length >= 2 && (surface.startsWith(honorific) || stem.startsWith(honorific))) {
        const body = surface.startsWith(honorific) ? surface : stem;
        const rest = body.slice(honorific.length);
        if (rest === "" || rest === "님") return true;
      }
    }
    return false;
  }

  function arrowJoin(text, left, right) {
    if (!left || !right) return false;
    if (!/^\s*→\s*$/.test(text.slice(left.end, right.start))) return false;
    return personShape(hangulStem(left.surface)) && personShape(hangulStem(right.surface));
  }

  function personContext(text, token, hangulOnLine) {
    const lineTokens = hangulOnLine[token.line] || [];
    const pos = lineTokens.indexOf(token);
    const prev = pos > 0 ? lineTokens[pos - 1] : null;
    const next = pos + 1 < lineTokens.length ? lineTokens[pos + 1] : null;
    if (next && isHonorificCue(next.surface)) return true;
    if (lineTokens.length === 1) return true;
    if (arrowJoin(text, prev, token) || arrowJoin(text, token, next)) return true;
    if ((prev && isPlace(hangulStem(prev.surface))) || (next && isPlace(hangulStem(next.surface)))) {
      return true;
    }
    if (lineTokens.length === 2 && pos === 0) return true;
    return false;
  }

  function latinPieceKind(surface) {
    if (DOC_CODE_RE.test(surface)) return "";
    if (IDENT_RE.test(surface)) return "ident";
    if (ACRONYM_RE.test(surface)) return "acronym";
    if (/^[A-Z]$/.test(surface)) return "single";
    if (/^[A-Z]/.test(surface) && /[a-z]/.test(surface)) return "title";
    return "";
  }

  function keepSingleLatin(surface, kind) {
    if (kind === "single") return false;
    if (kind === "acronym" && surface.length === 2) return false;
    if (STOP.has(surface.toLowerCase())) return false;
    if (kind === "title" && surface.length < 3) return false;
    return true;
  }

  function pushPhrase(phrases, seen, surface, kind, start, end) {
    if (phrases.length >= 32) return;
    if (surface.length !== end - start) return;
    const key = phraseKey(surface, kind);
    if (seen.has(key)) return;
    seen.add(key);
    phrases.push({ surface, key, kind, start, end });
  }

  function extractPhrases(text) {
    if (typeof text !== "string" || text.length === 0) return [];
    const tokens = scanTokens(text);
    const hangulOnLine = assignLines(text, tokens);
    const phrases = [];
    const seen = new Set();
    for (let i = 0; i < tokens.length && phrases.length < 32; i += 1) {
      const token = tokens[i];
      if (!token.hangul) {
        const kind = latinPieceKind(token.surface);
        if (!kind) continue;
        let j = i;
        while (j + 1 < tokens.length) {
          const next = tokens[j + 1];
          if (next.hangul || !latinPieceKind(next.surface)) break;
          if (text.slice(tokens[j].end, next.start) !== " ") break;
          j += 1;
        }
        if (j === i && !keepSingleLatin(token.surface, kind)) continue;
        const end = tokens[j].end;
        pushPhrase(phrases, seen, text.slice(token.start, end), "latin", token.start, end);
        i = j;
        continue;
      }
      const stem = hangulStem(token.surface);
      const end = token.start + stem.length;
      if (isPlace(stem)) {
        pushPhrase(phrases, seen, stem, "place", token.start, end);
        continue;
      }
      if (personShape(stem) && personContext(text, token, hangulOnLine)) {
        pushPhrase(phrases, seen, stem, "person", token.start, end);
      }
    }
    return phrases;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { extractPhrases };
  }
  if (typeof globalThis !== "undefined") {
    Object.assign(globalThis, { extractPhrases });
  }
})();
