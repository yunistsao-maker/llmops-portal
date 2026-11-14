/* LLMOps Portal — static, read-only UI. Reads data/ui.json (llmops-ui/v1) from the same site; no backend, no storage.
 * Routes (hash): #/  #/news  #/retire  #/models  #/adoption  #/model/<id>
 * All text from data is inserted with textContent (never innerHTML). */
(() => {
  "use strict";

  // ---------------------------------------------------------------- helpers
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "style") Object.assign(el.style, v);
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };
  const chip = (text, tone) => h("span", { class: "chip" + (tone ? " " + tone : "") }, text);
  const md = (s) => (s ? s.slice(5, 10) : "");
  const money = (v) => (v === null || v === undefined ? "—" : Number.isInteger(v) && v >= 1 ? `$${v}` : `$${v.toFixed(2)}`);
  const priceText = (p) => (p ? `${money(p.input)} / ${money(p.output)}` : "—");
  const fmtInt = (n) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
  const fmtTokens = (n) => (!n ? "—" : n >= 1e6 ? `${n / 1e6}M` : `${Math.round(n / 1000)}K`);
  const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : null);
  const ext = (url, text) => (safeUrl(url) ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, text) : h("span", null, text));
  const card = (attrs, ...kids) => h("article", { ...attrs, class: "card " + ((attrs && attrs.class) || "") }, ...kids);
  const head = (title, right) => h("div", { class: "card-head" }, h("h2", null, title), right || null);
  const SEC_TONE = { newModels: "", pricingChanges: "", lifecycleChanges: "warn", litellm: "", security: "hi", regulatory: "" };
  const STATUS_TONE = { ga: "ok", preview: "chip", "private-preview": "warn", "limited-access": "warn", "not-offered": "dashed" };
  const CLOUD_COLS = [["bedrock", "AWS Bedrock"], ["foundry", "Azure Foundry"], ["agent-platform", "GCP Agent Platform"]];
  const SEV = { high: "高", medium: "中", low: "低" };

  let UI = null;
  const state = { lens: "price", tier: "all", preset: 0, calc: null };
  const main = document.getElementById("main");
  const models = () => new Map(UI.models.map((m) => [m.id, m]));

  const sourceLinks = (ids) => {
    const list = (ids || []).map((id) => UI.sources[id]).filter(Boolean);
    if (!list.length) return null;
    return h("div", { class: "srcs" }, "來源：", list.map((s) => ext(s.url, s.publisher + "｜" + s.title)));
  };

  const availSummary = (m) => {
    const ga = [], other = [];
    for (const [svc, label] of CLOUD_COLS) {
      const c = m.clouds[svc];
      const short = { bedrock: "AWS", foundry: "Azure", "agent-platform": "GCP" }[svc];
      if (!c || c.status === "not-offered") continue;
      if (c.status === "ga") ga.push(short);
      else other.push(`${short} ${c.statusLabel}`);
    }
    const direct = Object.values(m.clouds).filter((c) => c.cloud === "vendor-direct" && c.status !== "not-offered").map((c) => c.serviceLabel);
    let s = ga.length === 3 ? "三雲 GA" : ga.length ? `${ga.join("、")} GA` : "";
    if (other.length) s += (s ? "；" : "") + other.join("、");
    if (!ga.length && !other.length) s = "三雲未上架";
    if (direct.length && ga.length < 3) s += `；另有 ${direct.join("、")}`;
    return s;
  };

  // ---------------------------------------------------------------- shell
  const setNav = (key) => {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  };
  const footer = () =>
    h("footer", { class: "site" },
      `資料：${UI.asOf}（digest ${UI.inputs.digest}，共 ${UI.inputs.digestCount} 份；catalog ${UI.inputs.catalogAsOf}；lifecycle ${UI.inputs.lifecycleAsOf}`,
      UI.inputs.securityRun ? `；security run ${UI.inputs.securityRun}` : "",
      `）。本站是靜態網站，只讀取 data/ui.json（schema llmops-ui/v1，由 tools/build_ui_data.py 自研究資料產生）。每則動態附原始連結；價格為牌價，以各雲官方頁為準。`);

  // ---------------------------------------------------------------- overview
  function renderOverview(anchor) {
    setNav("overview");
    const mm = models();
    const p = UI.period;
    const brief = card({ class: "f7" }, h("h2", null, "這週要處理的三件事"),
      h("div", { class: "list" }, UI.brief.map((b) =>
        h("div", { class: "brief-row" }, chip(b.priority, b.priority), h("span", { class: "t" }, b.text, b.due ? h("span", { class: "muted small" }, `　期限 ${md(b.due)}`) : null)))));
    const kpis = h("div", { class: "f5 kpis" }, UI.kpis.map((k) =>
      h("a", { class: "kpi", href: k.href }, h("span", { class: "v" + (k.tone === "alert" ? " alert" : "") }, k.value), h("span", { class: "k" }, k.label), h("span", { class: "n" }, k.note))));

    const news = card({ id: "news", class: "f3" },
      head("本期其他動態", h("span", { class: "small muted" }, `本期 ${UI.news.periodCount} 則 · 累計 ${UI.news.totalCount} 則`)),
      h("div", { class: "list" }, UI.news.items.map((n) =>
        h("div", { class: "news-row" },
          h("span", { class: "d" }, md(n.date)),
          h("span", { class: "sec" }, chip(n.sectionLabel, SEC_TONE[n.section])),
          h("div", { class: "body" + (n.impact === "high" ? " imp-high" : "") },
            h("details", null,
              h("summary", null, n.title, " ", h("span", { class: "where" }, n.where)),
              h("p", { class: "detail" }, n.detail), sourceLinks(n.sources)))))),
      UI.news.checks.length ? h("details", { class: "more" }, h("summary", null, `已複查、沒有變動（${UI.news.checks.length}）`),
        h("ul", null, UI.news.checks.map((c) => h("li", null, h("b", null, c.title), "：", c.detail)))) : null,
      UI.unverified.length ? h("details", { class: "more" }, h("summary", null, `尚未驗證（${UI.unverified.length}）`),
        h("ul", null, UI.unverified.map((u) => h("li", null, u)))) : null);

    const R = UI.retirements;
    const retire = card({ id: "retire", class: "f2" },
      head(`${R.windowDays} 天內退役`, h("span", { class: "small muted" }, `${R.eventCount} 筆 · 以 ${UI.asOf} 計算`)),
      h("div", { class: "list" }, R.rows.length ? R.rows.map((r) =>
        h("div", { class: "ret-row" },
          h("span", { class: "d" }, md(r.date)),
          h("span", null, chip(r.days === 0 ? "今天" : `剩 ${r.days} 天`, r.days <= 14 ? "danger" : "warn")),
          h("span", { class: "w" }, h("span", { class: "a" }, r.what), h("span", { class: "b" }, r.where + (r.replacement ? ` → ${r.replacement}` : ""))))) : h("p", { class: "empty" }, "30 天內沒有退役事件。")),
      R.noSoonerThan.length || R.priceChanges.length || R.later.length ? h("p", { class: "foot-note" },
        R.noSoonerThan.length ? `「不早於」：${R.noSoonerThan.map((x) => `${md(x.date)} ${x.what}（${x.where}）`).join("、")}。` : "",
        R.priceChanges.length ? `價格調整：${R.priceChanges.map((x) => `${md(x.date)} ${x.what}（${x.where}）`).join("、")}。` : "",
        R.later.length ? `下一批：${R.later.slice(0, 4).map((x) => `${md(x.date)} ${x.what}（${x.where}）`).join("、")}。` : "") : null);

    const tiers = h("section", { id: "models", class: "list", style: { gap: "12px" } },
      h("div", { class: "card-head" }, h("h2", null, "依用途挑模型"), h("a", { href: "#/models", class: "small" }, "看模型 × 雲端矩陣 →")),
      h("div", { class: "grid-auto" }, UI.tiers.map((t) => card(null,
        h("div", null, h("h3", null, t.name), h("span", { class: "small muted" }, t.hint)),
        h("div", { class: "list" }, t.modelIds.map((id) => {
          const m = mm.get(id);
          return h("div", { class: "mrow" },
            h("div", { class: "top" },
              h("span", { class: "nm" }, h("a", { href: `#/model/${m.id}` }, m.name)),
              h("span", { class: "aa" }, m.aa ? `AA ${m.aa.score}` : "AA —"),
              h("span", { class: "pr" }, priceText(m.priceMin))),
            h("span", { class: "av" }, availSummary(m)));
        }))))),
      h("p", { class: "small muted" }, "價格是各雲最低的 global 牌價，每 1M tokens（input / output，USD）。AA 是 Artificial Analysis Intelligence Index v5（2026-10-27 改版，不能和 v4.3.2 比較）；「AA —」表示 v5 榜上沒有分數。",
        ` ${UI.models.filter((m) => m.platformStatus === "evaluating").length} 個模型都在評估中，還沒有核准上線的模型。`));

    const open = card({ id: "open" },
      head("開放權重：熱門", h("span", { class: "small muted" }, `追蹤 ${UI.openModels.tracked} 個 · ${UI.openModels.asOf}`)),
      h("div", { class: "list" }, UI.openModels.items.map((o) =>
        h("div", { class: "mrow" }, h("div", { class: "card-head" }, h("span", { class: "nm" }, o.name), h("span", { class: "small" }, o.host)), h("span", { class: "av" }, o.meta)))),
      h("p", { class: "foot-note" }, "中國開發的模型與自訂授權，上架前要經法務確認（含 MOFCOM 第 48 號公告的出口管制進度）。"));

    const S = UI.tests.security;
    const tests = card({ id: "tests" },
      head("內部測試", h("a", { href: "#/adoption", class: "small" }, "看導入看板 →")),
      h("div", { class: "list" },
        S ? h("div", { class: "li" },
          h("div", { class: "card-head" }, h("b", { class: "small", style: { fontSize: "14px" } }, "安全測試 G6"), h("span", { class: "small muted mono" }, `${S.date} · ${fmtInt(S.caseCount)} 筆案例`)),
          S.models.map((r) => h("div", { class: "chips", style: { marginTop: "6px" } },
            h("a", { class: "who", href: `#/model/${r.modelId}` }, r.name), chip(`通過 ${r.pass}`, "ok"), chip(`未通過 ${r.fail}`, "danger"), chip(`待複核 ${r.review}`, "warn"))),
          h("p", { class: "small muted", style: { marginTop: "6px" } },
            S.commonFails.length ? `都未通過：${S.commonFails.map((f) => `${f.id} ${f.title}`).join("、")}。` : "",
            `其餘 ${S.untested.length} 個模型還沒有測。`)) : h("p", { class: "li empty" }, "還沒有安全測試結果。"),
        h("div", { class: "li" }, h("b", { style: { fontSize: "14px" } }, "Gateway 相容 G3 · 效能 G4"), h("p", { class: "small muted" }, UI.tests.compat.note || `相容 ${UI.tests.compat.runs} 次、效能 ${UI.tests.perf.runs} 次實測。`)),
        h("div", { class: "li" }, h("b", { style: { fontSize: "14px" } }, "成本 G7"), h("p", { class: "small muted" }, UI.tests.cost.note))));

    const apply = card({ id: "apply" }, h("h2", null, "申請使用模型"),
      h("p", { class: "small muted", style: { fontSize: "14px" } }, "填一次表單，平台團隊依資料等級與用途決定要過哪些關卡；結果回寫到模型頁。"),
      h("ol", { class: "steps" }, [
        ["提出申請 G0", "用途、資料等級、預估用量、偏好的雲"], ["法遵與資料審查 G2", "處理地點、保留期、法規對應"],
        ["技術驗證 G3–G7", "已測過的模型直接沿用結果"], ["Beta G8", "限定團隊兩週，沒有 P1 事件"], ["上線 G9", "開通 gateway 別名與 virtual key"],
      ].map(([t, d], i) => h("li", null, h("span", { class: "n" }, i + 1), h("span", null, h("b", null, t), "：", d)))),
      h("p", { class: "small muted" }, "這個網站是唯讀的靜態頁面，不收任何資料；申請請走公司內部的申請表單。"));

    main.replaceChildren(
      h("div", { class: "title-row" },
        h("div", null, h("div", { class: "eyebrow" }, `總覽 · 每週更新，本期 ${p.start} – ${p.end}`), h("h1", null, "本期重點")),
        h("a", { class: "btn", href: "#/", onclick: (e) => { e.preventDefault(); document.getElementById("apply").scrollIntoView({ behavior: "smooth" }); } }, "申請使用模型")),
      h("p", { class: "lede" }, p.headline),
      h("section", { class: "row tight" }, brief, kpis),
      h("section", { class: "row" }, news, retire),
      tiers,
      h("section", { class: "grid-auto" }, open, tests, apply),
      footer());
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
  }

  // ---------------------------------------------------------------- models matrix
  function cellNode(c, lens) {
    if (!c || c.status === "not-offered") return h("div", { class: "cell" }, chip("未上架", "dashed"));
    const kids = [h("div", null, chip(c.statusLabel, STATUS_TONE[c.status] || ""), c.since ? h("span", { class: "sub mono" }, ` 自 ${c.since}`) : null)];
    if (lens === "price") {
      kids.push(h("span", { class: "price" }, c.priceGlobal ? `${priceText(c.priceGlobal)}` : "價格未公布"));
      if (c.priceResidency) kids.push(h("span", { class: "sub" }, `駐留 ${priceText(c.priceResidency)}（${c.priceResidency.scope}）`));
      if (c.note) kids.push(h("span", { class: "sub" }, c.note));
    } else {
      kids.push(h("div", null, chip(c.taiwan === "global-cris" ? "台北：Global CRIS" : "台北：不可用", c.taiwan === "global-cris" ? "warn" : "dashed")));
      const apac = (c.apac || []).filter((a) => a.scopes && a.scopes.some((s) => s !== "global")).map((a) => `${a.label}（${a.scopes.join("、")}）`);
      if (apac.length) kids.push(h("span", { class: "sub" }, `亞太駐留：${apac.join("、")}`));
      if (c.residency && c.residency.length) kids.push(h("span", { class: "sub" }, `駐留選項：${c.residency.join("、")}`));
      if (c.note) kids.push(h("span", { class: "sub" }, c.note));
    }
    return h("div", { class: "cell" }, kids);
  }

  function renderModels() {
    setNav("models");
    const list = UI.models.filter((m) => state.tier === "all" || m.tier === state.tier)
      .sort((a, b) => ["frontier", "balanced", "efficient"].indexOf(a.tier) - ["frontier", "balanced", "efficient"].indexOf(b.tier) || (b.aa?.score ?? -1) - (a.aa?.score ?? -1));
    const seg = (key, opts) => h("div", { class: "seg", role: "group" }, opts.map(([v, label]) =>
      h("button", { type: "button", "aria-pressed": String(state[key] === v), onclick: () => { state[key] = v; renderModels(); } }, label)));
    const table = h("div", { class: "table-wrap" }, h("table", { class: "matrix" },
      h("caption", { class: "small muted", style: { captionSide: "bottom", textAlign: "left", padding: "10px 14px" } },
        state.lens === "price" ? "價格：每 1M tokens（input / output，USD），global 牌價；駐留價為 Geo / Data Zone / multi-region 等非 global 選項。"
          : "台北：AWS 台北區（ap-east-2）只能經 Global CRIS，資料可能在任何區域處理；Azure 與 GCP 沒有台灣區域。三雲都沒有台灣境內處理。"),
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "模型"), h("th", { scope: "col" }, "AA v5"), CLOUD_COLS.map(([, l]) => h("th", { scope: "col" }, l)))),
      h("tbody", null, list.map((m) => h("tr", null,
        h("th", { scope: "row" }, h("a", { href: `#/model/${m.id}` }, m.name), h("div", { class: "small muted" }, `${m.tierLabel} · ${m.vendorLabel}`)),
        h("td", { class: "mono" }, m.aa ? m.aa.score : "—"),
        CLOUD_COLS.map(([svc]) => h("td", null, cellNode(m.clouds[svc], state.lens))))))));
    const max = 70;
    const bands = h("section", { class: "list", style: { gap: "12px" } },
      h("h2", null, "同樣的牌價，誰的分數高"),
      h("div", { class: "bands" }, UI.priceBands.map((b) => card(null, h("h3", null, b.label),
        b.models.map((m) => h("div", { class: "bar-row" },
          h("a", { href: `#/model/${m.id}` }, m.name),
          h("div", { class: "bar", role: "img", "aria-label": `AA ${m.aa ?? "無分數"}` }, h("span", { style: { width: `${Math.max(0, Math.min(100, ((m.aa || 0) / max) * 100))}%` } })),
          h("span", { class: "mono small" }, m.aa ?? "—")))))),
      h("p", { class: "small muted" }, "以各模型最低的 global output 牌價分組；長條是 AA Intelligence Index v5（滿刻度 70）。"));
    main.replaceChildren(
      h("div", { class: "title-row" }, h("div", null, h("div", { class: "eyebrow" }, `模型 · ${UI.models.length} 個評估中`), h("h1", null, "模型 × 雲端矩陣"))),
      h("div", { class: "toolbar" },
        seg("lens", [["price", "上架與價格"], ["tw", "台北與駐留"]]),
        seg("tier", [["all", "全部"], ["frontier", "旗艦"], ["balanced", "主力"], ["efficient", "輕量"]]),
        h("span", { class: "small muted", "aria-live": "polite" }, `顯示 ${list.length} 個模型`)),
      state.lens === "tw" ? h("p", { class: "notice" }, "三雲目前都沒有台灣境內處理。需要境內處理的資料等級，現階段只能用地端或開放權重模型。") : null,
      table, bands, footer());
  }

  // ---------------------------------------------------------------- adoption
  const stripNode = (gates) => h("div", { class: "strip", role: "img", "aria-label": gates.map((g) => `${g.gate} ${g.state}`).join("，") },
    gates.map((g) => h("span", { class: g.state, title: `${g.gate}：${g.state}` })));

  function renderAdoption() {
    setNav("adoption");
    const todoState = (t) => {
      if (t.overdue) return h("span", { class: "st late" }, `已過期限 ${-t.days} 天`);
      if (t.days === null) return h("span", { class: "st muted" }, "持續");
      if (t.days === 0) return h("span", { class: "st late" }, "今天");
      if (t.days === 1) return h("span", { class: "st late" }, "明天");
      return h("span", { class: "st" }, `${t.days} 天後`);
    };
    const open = UI.todos.filter((t) => !t.overdue);
    const late = UI.todos.filter((t) => t.overdue);
    main.replaceChildren(
      h("div", { class: "title-row" }, h("div", null, h("div", { class: "eyebrow" }, `導入 · 以 ${UI.asOf} 計算`), h("h1", null, "導入看板"))),
      UI.decisions.length ? h("section", { class: "list", style: { gap: "12px" } }, h("h2", null, "需要決策"),
        h("div", { class: "decisions" }, UI.decisions.map((d) => h("div", { class: "decision" },
          h("span", { class: "t" }, d.title), d.due ? h("span", { class: "small mono muted" }, `決定期限 ${d.due}`) : null,
          h("span", { class: "small" }, d.why), h("span", { class: "small muted" }, `負責：${d.who}`))))) : null,
      card(null, head("待辦與期限", h("span", { class: "small muted" }, `進行中 ${open.length} 項 · 近 14 天已過期限 ${late.length} 項`)),
        h("div", { class: "list" }, open.map((t) => h("div", { class: "todo-row" },
          chip(t.priority, t.priority), h("span", { class: "mono small muted" }, t.due ? md(t.due) : "—"), todoState(t),
          h("span", { class: "txt" }, t.text, t.isNew ? h("span", null, " ", chip("本期新增", "ok")) : null)))),
        late.length ? h("details", { class: "more" }, h("summary", null, `已過期限（${late.length}）——確認是否已完成`),
          h("div", { class: "list" }, late.map((t) => h("div", { class: "todo-row" },
            chip(t.priority, t.priority), h("span", { class: "mono small muted" }, md(t.due)), todoState(t), h("span", { class: "txt" }, t.text))))) : null),
      h("section", { class: "list", style: { gap: "12px" } }, h("h2", null, "關卡看板"),
        h("div", { class: "board" }, UI.board.map((c) => h("div", { class: "col" },
          h("h3", null, h("span", null, c.title), h("span", { class: "g" }, `${c.gates} · ${c.items.length}`)),
          c.items.length ? c.items.map((it) => h("div", { class: "tile" },
            it.modelId ? h("a", { href: `#/model/${it.modelId}` }, it.title) : h("span", null, it.title), h("div", null, chip(it.tag, it.tone === "chip" ? "" : it.tone))))
            : h("p", { class: "empty" }, c.empty || "目前沒有項目。"))))),
      card(null, head("每個模型的關卡進度", h("span", { class: "small muted" }, "G0–G10")),
        h("div", { class: "strip-row" }, h("span"), h("div", { class: "strip labels" }, UI.gates.map((g) => h("span", { title: g.title }, g.gate)))),
        UI.models.map((m) => h("div", { class: "strip-row" }, h("a", { href: `#/model/${m.id}` }, m.name), stripNode(m.gates))),
        h("div", { class: "legend" }, [["ok", "完成"], ["doing", "進行中"], ["block", "未通過"], ["todo", "未開始"]].map(([k, l]) =>
          h("span", null, h("i", { style: { background: `var(--g-${k})` } }), l))),
        h("p", { class: "foot-note" }, "關卡狀態由資料推導：G1 有 deep dive 即完成；G2 在研究完成後列為進行中（核准紀錄尚未接入）；G6 依最近一次安全測試；G7 有牌價即列為進行中（試算，尚無帳單）。",
          UI.gates.map((g) => `${g.gate} ${g.title}`).join("；"), "。")),
      footer());
  }

  // ---------------------------------------------------------------- model page
  const PRESETS = [
    { name: "客服問答", rpd: 30000, inTok: 2000, outTok: 400 },
    { name: "文件摘要", rpd: 5000, inTok: 12000, outTok: 800 },
    { name: "程式代理", rpd: 2000, inTok: 30000, outTok: 3000 },
  ];

  function renderModel(id) {
    setNav("models");
    const m = models().get(id);
    if (!m) {
      main.replaceChildren(h("p", { class: "err" }, "找不到這個模型。"), h("a", { href: "#/models" }, "回模型列表"), footer());
      return;
    }
    const cells = Object.values(m.clouds).filter((c) => c.status !== "not-offered" || c.cloud !== "vendor-direct");
    const offered = cells.filter((c) => c.status !== "not-offered");
    const S = m.security;
    const tiles = [
      ["AA Intelligence Index", m.aa ? String(m.aa.score) : "—", m.aa ? `v5${m.aa.variant ? `（${m.aa.variant}）` : ""} · ${m.aa.date}` : `v5 沒有分數${m.aaPrevious ? `；v${m.aaPrevious.version?.replace(/^v/, "")} 為 ${m.aaPrevious.score}（不可比較）` : ""}`],
      ["輸出速度", m.perf?.outputTokensPerSec ? `${m.perf.outputTokensPerSec} tok/s` : "—", m.perf ? `${m.perf.provider || ""} ${m.perf.date || ""}` : "還沒有量測"],
      ["最低牌價", priceText(m.priceMin), "每 1M tokens，input / output"],
      ["Context / 輸出上限", `${fmtTokens(m.contextWindow)} / ${fmtTokens(m.maxOutputTokens)}`, "tokens"],
      ["安全測試 G6", S ? `${S.pass} / ${S.pass + S.fail + S.review}` : "未測", S ? `未通過 ${S.fail}、待複核 ${S.review}` : "排入下一輪安全測試"],
    ];
    const rows = [
      ["狀態", (c) => h("div", null, chip(c.statusLabel, STATUS_TONE[c.status] || ""), c.since ? h("div", { class: "small muted mono" }, `自 ${c.since}`) : null)],
      ["Global 牌價", (c) => h("span", { class: "mono" }, priceText(c.priceGlobal))],
      ["駐留牌價", (c) => c.priceResidency ? h("span", null, h("span", { class: "mono" }, priceText(c.priceResidency)), h("div", { class: "small muted" }, c.priceResidency.scope)) : h("span", { class: "muted" }, "—")],
      ["台灣境內處理", (c) => h("span", null, "否", h("div", { class: "small muted" }, c.taiwanLabel || ""))],
      ["駐留選項", (c) => h("span", { class: "small" }, (c.residency || []).join("、") || "—")],
      ["Structured outputs", (c) => h("span", { class: "small" }, c.structuredOutputs ? { supported: "支援", "not-supported": "不支援", partial: "部分", unknown: "未確認" }[c.structuredOutputs.status] || c.structuredOutputs.status : "未確認")],
      ["最早生命週期事件", (c) => h("span", { class: "small mono" }, c.earliestEvent ? `${c.earliestEvent.date}（${c.earliestEvent.event === "eol-no-sooner-than" ? "不早於" : c.earliestEvent.event}）` : "未公告")],
      ["LiteLLM model", (c) => h("code", { class: "small" }, c.litellmModel || "—")],
      ["來源", (c) => h("span", { class: "small" }, (c.sources || []).slice(0, 3).map((sid) => UI.sources[sid]).filter(Boolean).map((s, i) => [i ? "、" : "", ext(s.url, s.publisher)]))],
    ];
    const cmp = h("div", { class: "table-wrap" }, h("table", { class: "matrix" },
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "項目"), offered.map((c) => h("th", { scope: "col" }, c.serviceLabel)))),
      h("tbody", null, rows.map(([label, fn]) => h("tr", null, h("th", { scope: "row" }, label), offered.map((c) => h("td", null, c.fromCatalog || label === "狀態" ? fn(c) : h("span", { class: "small muted" }, c.note || "—"))))))));

    // cost calculator
    if (!state.calc || state.calc.id !== m.id) state.calc = { id: m.id, ...PRESETS[0] };
    const calcOut = h("div", { class: "list", "aria-live": "polite" });
    const recompute = () => {
      const { rpd, inTok, outTok } = state.calc;
      const priced = offered.filter((c) => c.priceGlobal);
      calcOut.replaceChildren(...(priced.length ? priced.map((c) => {
        const per = (p) => (inTok * p.input + outTok * p.output) / 1e6;
        const g = per(c.priceGlobal);
        const r = c.priceResidency ? per(c.priceResidency) : g * 1.1;
        return h("div", { class: "li card-head" }, h("b", null, c.serviceLabel),
          h("span", { class: "mono small" }, `Global 每月 $${fmtInt(Math.round(g * rpd * 30))}（每千次 $${(g * 1000).toFixed(2)}）`),
          h("span", { class: "mono small muted" }, `駐留 ${c.priceResidency ? "" : "估 1.1×"} 每月 $${fmtInt(Math.round(r * rpd * 30))}`));
      }) : [h("p", { class: "empty" }, "沒有可用的牌價。")]));
    };
    const num = (key, label) => h("label", null, label, h("input", { type: "number", min: "0", step: "1", value: state.calc[key], inputmode: "numeric",
      oninput: (e) => { state.calc[key] = Math.max(0, Number(e.target.value) || 0); recompute(); } }));
    const presetBtns = h("div", { class: "seg", role: "group", "aria-label": "用量情境" }, PRESETS.map((p, i) =>
      h("button", { type: "button", "aria-pressed": String(state.preset === i), onclick: () => { state.preset = i; state.calc = { id: m.id, ...p }; renderModel(id); } }, p.name)));
    recompute();

    main.replaceChildren(
      h("div", { class: "crumb" }, h("a", { href: "#/models" }, "模型"), " / ", m.name),
      h("div", { class: "list", style: { gap: "8px" } },
        h("div", { class: "mh" }, h("h1", null, m.name), chip(m.tierLabel), chip(m.platformStatusLabel, "warn")),
        h("div", { class: "small muted" }, `${m.vendorLabel} · 發布 ${m.releaseDate || "—"} · `, h("code", null, m.vendorModelId)),
        h("p", { class: "lede" }, m.tldr || m.summary || ""),
        h("div", { class: "toolbar" },
          m.modelCardUrl ? h("a", { class: "btn ghost", href: safeUrl(m.modelCardUrl), target: "_blank", rel: "noopener noreferrer" }, "官方模型卡 ↗") : null,
          h("a", { class: "btn", href: "#/", onclick: (e) => { e.preventDefault(); location.hash = "#/"; setTimeout(() => document.getElementById("apply")?.scrollIntoView(), 50); } }, "申請使用"))),
      h("div", { class: "kpi-tiles" }, tiles.map(([k, v, n]) => h("div", { class: "tile-k" }, h("span", { class: "k" }, k), h("span", { class: "v" }, v), h("span", { class: "n" }, n)))),
      h("section", { class: "grid-auto" },
        card(null, h("h2", null, "為什麼值得評估"), h("ul", { class: "bul" }, [...m.strengths, ...m.bestFor.slice(0, 2)].map((s) => h("li", null, s)))),
        card(null, h("h2", null, "導入前要知道"), h("ul", { class: "bul" }, [...m.weaknesses, ...m.avoidFor.slice(0, 2)].map((s) => h("li", null, s))))),
      h("section", { class: "list", style: { gap: "12px" } }, h("h2", null, "三雲比較"), cmp),
      h("section", { class: "grid-auto" },
        card(null, h("h2", null, "內部測試"),
          h("div", { class: "li" }, h("b", null, "G3 Gateway 相容"), h("p", { class: "small muted" }, UI.tests.compat.note || "見 compat run。")),
          h("div", { class: "li" }, h("b", null, "G4 效能"), h("p", { class: "small muted" }, UI.tests.perf.note || "見 perf run。")),
          h("div", { class: "li" }, h("b", null, "G6 安全"),
            S ? [h("div", { class: "chips" }, chip(`通過 ${S.pass}`, "ok"), chip(`未通過 ${S.fail}`, "danger"), chip(`待複核 ${S.review}`, "warn")),
              h("ul", { class: "bul small", style: { marginTop: "6px" } }, S.fails.map((f) => h("li", null, h("b", null, f.id), ` ${f.title}：失敗率 ${f.rate === null ? "—" : Math.round(f.rate * 100) + "%"}（${f.rule}）`))),
              h("p", { class: "small muted" }, `run ${UI.tests.security.runId} · ${UI.tests.security.date} · LiteLLM ${UI.tests.security.litellmVersion || "—"} · judge ${UI.tests.security.judge || "—"}`)]
              : h("p", { class: "small muted" }, "還沒有測。"))),
        card(null, h("h2", null, "成本試算"), presetBtns,
          h("div", { class: "calc" }, num("rpd", "每日請求數"), num("inTok", "每次 input tokens"), num("outTok", "每次 output tokens")),
          calcOut, h("p", { class: "small muted" }, "以牌價計算、每月 30 天，未含 cache、batch 與長 context 加價；駐留價沒有公布時以 global 的 1.1 倍估算。"))),
      card(null, head("導入進度", h("a", { class: "small", href: "#/adoption" }, "看導入看板 →")),
        h("div", { class: "strip labels" }, UI.gates.map((g) => h("span", { title: g.title }, g.gate))), stripNode(m.gates)),
      h("section", { class: "grid-auto" },
        card(null, h("h2", null, "行為變更"), m.behaviourChanges.length ? h("ul", { class: "bul" }, m.behaviourChanges.map((b) =>
          h("li", null, h("span", { class: `sev-${b.severity}` }, `[${SEV[b.severity]}] `), h("b", null, b.title), `：${b.detail} `, h("span", { class: "muted" }, `遷移：${b.migration}`))))
          : h("p", { class: "empty" }, m.hasDeepDive ? "沒有列出行為變更。" : "還沒有 deep dive（G1 進行中）。")),
        card(null, h("h2", null, "它可以取代"), m.replaces.length ? h("div", { class: "list" }, m.replaces.map((r) =>
          h("div", { class: "ret-row" }, h("span", { class: "d" }, md(r.date)), h("span", null, chip(r.event === "retirement" ? "退役" : r.event, "warn")), h("span", { class: "w" }, h("span", { class: "a" }, r.what), h("span", { class: "b" }, r.where)))))
          : h("p", { class: "empty" }, "目前沒有以它為官方替代的退役事件。")),
        card(null, h("h2", null, "相關動態"), m.related.length ? h("div", { class: "list" }, m.related.map((r) =>
          h("div", { class: "li" }, h("span", { class: "mono small muted" }, md(r.date)), " ", chip(r.sectionLabel, SEC_TONE[r.section]), " ", h("span", { class: "small" }, r.title))))
          : h("p", { class: "empty" }, "近期沒有相關動態。"))),
      footer());
  }

  // ---------------------------------------------------------------- router
  function route() {
    if (!UI) return;
    const hash = location.hash || "#/";
    const m = hash.match(/^#\/model\/([a-z0-9-]+)$/);
    if (m) renderModel(m[1]);
    else if (hash === "#/models") renderModels();
    else if (hash === "#/adoption") renderAdoption();
    else if (hash === "#/news") renderOverview("news");
    else if (hash === "#/retire") renderOverview("retire");
    else renderOverview(null);
    if (!/^#\/(news|retire)$/.test(hash)) window.scrollTo(0, 0);
    document.title = `LLMOps Portal · ${{ "#/models": "模型", "#/adoption": "導入" }[hash] || (m ? models().get(m[1])?.name || "模型" : "總覽")}`;
  }

  fetch("data/ui.json", { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((data) => {
      if (data.schema !== "llmops-ui/v1") throw new Error(`不支援的資料版本 ${data.schema}`);
      UI = data;
      document.getElementById("asof").textContent = `資料 ${UI.asOf}`;
      window.addEventListener("hashchange", route);
      route();
    })
    .catch((e) => main.replaceChildren(h("p", { class: "err" }, `資料載入失敗：${e.message}`)));
})();
