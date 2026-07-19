const GRAPH_API = "https://graph.facebook.com/v21.0";

const BUSINESS_INBOX_URLS = (pageId) => [
  `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&mailbox_id=${encodeURIComponent(pageId)}`,
  `https://business.facebook.com/latest/inbox?asset_id=${encodeURIComponent(pageId)}`,
  `https://business.facebook.com/latest/inbox/messenger?asset_id=${encodeURIComponent(pageId)}`,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortError(error, max = 420) {
  const raw = String(error?.message || error || "Unknown error");
  return raw.length > max ? `${raw.slice(0, max)}…` : raw;
}

function cleanName(value) {
  return String(value || "")
    .replace(/\s*\(\+?\d+\)\s*$/u, "")
    .replace(/^\s*صورة\s+ملف\s+/u, "")
    .replace(/\s+الشخصية?$/u, "")
    .replace(/^\s*Profile\s+picture\s+of\s+/iu, "")
    .replace(/'s\s+profile\s+picture$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRealName(value) {
  const name = cleanName(value);
  if (!name || name.length < 2 || name.length > 200) return false;
  if (/^facebook$/i.test(name)) return false;
  if (/^\d{5,}$/.test(name)) return false;
  if (/^(ترويج|روّج|روج|إعلان|اعلان|الإعلانات?|الاعلانات?|اختيار\s+هدف|اختر\s+هدف|جلب\s+العملاء|promote|boost|ad|ads|advertise|sponsor(ed)?|create ad)$/i.test(name)) return false;
  if (/profile\s+picture|لا يتوفر وصف للصورة|قد تكون صورة/i.test(name)) return false;
  return true;
}

async function emitPipelineLog(report, stage, status, message, details = {}) {
  if (typeof report !== "function") return;
  try {
    await report({
      result: {
        target: `messenger_pipeline:${Date.now()}:${stage}:${status}`,
        status: "skipped",
        data: {
          kind: "messenger_pipeline_log",
          stage,
          status,
          message,
          at: new Date().toISOString(),
          ...details,
        },
      },
    });
  } catch (_) {
    // Logging must never break extraction.
  }
}

async function runStage(report, stage, label, fn, options = {}) {
  const retries = Math.max(0, options.retries ?? 1);
  const timeoutMs = options.timeoutMs ?? 30_000;
  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const started = Date.now();
    await emitPipelineLog(report, stage, "started", label, { attempt, timeout_ms: timeoutMs });
    try {
      const result = await Promise.race([
        fn(attempt),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT_${stage}_${timeoutMs}ms`)), timeoutMs)),
      ]);
      await emitPipelineLog(report, stage, "ok", label, { attempt, duration_ms: Date.now() - started });
      return result;
    } catch (error) {
      lastError = error;
      await emitPipelineLog(report, stage, "failed", label, {
        attempt,
        duration_ms: Date.now() - started,
        error: shortError(error),
      });
      if (attempt <= retries) await sleep(600 * attempt);
    }
  }
  throw lastError;
}

function extractTokensFromText(value) {
  const text = String(value || "");
  const tokens = [];
  const patterns = [
    /(?:access_token|accessToken)["'=:\s]+(EAA[A-Za-z0-9_\-]{80,})/g,
    /\b(EAA[A-Za-z0-9_\-]{100,})\b/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      const token = match[1];
      if (token && token.startsWith("EAA") && !tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

function createMetaNetworkInspector(page) {
  const tokens = new Set();
  const payloads = [];
  const interestingUrlRe = /(graph\.facebook\.com|business\.facebook\.com\/(?:api\/graphql|ajax|business_locations|latest\/inbox)|\/api\/graphql|mercury|messag|inbox)/i;

  const addText = (text, source) => {
    for (const token of extractTokensFromText(text)) tokens.add(token);
    if (!text || payloads.length >= 160) return;
    const trimmed = String(text).slice(0, 1_500_000);
    if (!/[\{\[]/.test(trimmed)) return;
    try {
      const jsonStart = Math.max(0, Math.min(
        ...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((n) => n >= 0),
      ));
      const json = JSON.parse(trimmed.slice(jsonStart));
      payloads.push({ source, json });
    } catch (_) {
      // Business Suite sometimes prefixes JSON responses; best-effort only.
    }
  };

  page.on("request", (request) => {
    try {
      const url = request.url();
      if (!interestingUrlRe.test(url)) return;
      addText(decodeURIComponent(url), url);
      const post = request.postData();
      if (post) addText(post, url);
    } catch (_) {}
  });

  page.on("response", async (response) => {
    try {
      const url = response.url();
      if (!interestingUrlRe.test(url)) return;
      addText(decodeURIComponent(url), url);
      const headers = response.headers() || {};
      const type = String(headers["content-type"] || "");
      if (!/json|javascript|text|html/i.test(type)) return;
      const text = await response.text().catch(() => "");
      addText(text, url);
    } catch (_) {}
  });

  return {
    tokens,
    payloads,
    tokenList: () => Array.from(tokens),
    payloadCount: () => payloads.length,
  };
}

async function waitForReactReady(page, report, stage = "react_ready", timeoutMs = 12_000) {
  await runStage(report, stage, "انتظار تحميل واجهة Business Suite", async () => {
    const idleWait = typeof page.waitForNetworkIdle === "function"
      ? page.waitForNetworkIdle({ idleTime: 900, timeout: timeoutMs }).catch(() => null)
      : sleep(1200);
    await Promise.race([idleWait, sleep(timeoutMs)]);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const snapshot = await page.evaluate(() => {
      const body = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 1000);
      const htmlLen = document.documentElement?.innerHTML?.length || 0;
      return { url: location.href, title: document.title || "", body, htmlLen };
    });
    if (/\/login|checkpoint|two_factor/i.test(snapshot.url) || /تسجيل الدخول|log in|checkpoint/i.test(snapshot.body)) {
      throw new Error("SESSION_EXPIRED: Facebook طلب تسجيل دخول أو تحقق.");
    }
    if (snapshot.htmlLen < 2000) throw new Error("Business Suite لم يكتمل تحميله بعد.");
    return snapshot;
  }, { retries: 1, timeoutMs: timeoutMs + 2_000 });
}

async function fbGet(pathOrUrl, token) {
  const url = /^https?:\/\//i.test(pathOrUrl)
    ? `${pathOrUrl}${pathOrUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`
    : `${GRAPH_API}${pathOrUrl}${pathOrUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) {
    const err = json?.error || {};
    throw new Error(err.message || `Graph API HTTP ${response.status}`);
  }
  return json;
}

async function extractGraphTokenFromSession(page, report, options = {}) {
  const inspector = options.inspector || createMetaNetworkInspector(page);
  const perUrlTimeoutMs = options.perUrlTimeoutMs ?? 14_000;
  const readyTimeoutMs = options.readyTimeoutMs ?? 4_000;
  const settleMs = options.settleMs ?? 250;
  const skipReactReady = options.skipReactReady === true;
  const urls = options.urls || [
    "https://business.facebook.com/latest/home",
    "https://business.facebook.com/latest/inbox/all",
  ];

  await runStage(report, "session_anchor", "تثبيت جلسة Facebook قبل فتح Business Suite", async () => {
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: Math.min(perUrlTimeoutMs, 8_000) });
    await sleep(350);
    const cookies = await page.cookies("https://www.facebook.com", "https://business.facebook.com");
    const cUser = cookies.find((c) => c.name === "c_user" && c.value);
    if (!cUser) throw new Error("SESSION_EXPIRED: لا توجد c_user بعد فتح facebook.com.");
    const blocked = await page.evaluate(() => {
      const href = location.href;
      const body = document.body?.innerText || "";
      const hasLoginForm = !!document.querySelector('form[action*="login"], input[name="email"], input[name="pass"]');
      return /\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(href) ||
        hasLoginForm ||
        /تسجيل الدخول|log in|checkpoint|تأكيد الهوية|تحقق أمني/i.test(body);
    }).catch(() => false);
    if (blocked) throw new Error("SESSION_EXPIRED: Facebook طلب تسجيل دخول أو تحقق عند تثبيت الجلسة.");
    return true;
  }, { retries: 0, timeoutMs: Math.min(perUrlTimeoutMs, 8_000) + 2_000 });

  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    await runStage(report, "token_probe", `فتح مصدر آمن للتوكن ${i + 1}/${urls.length}`, async () => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: perUrlTimeoutMs });
      if (!skipReactReady) await waitForReactReady(page, report, "token_react_ready", readyTimeoutMs).catch(() => null);
      await sleep(settleMs);
      const blocked = await page.evaluate(() => {
        const href = location.href;
        const body = document.body?.innerText || "";
        const hasLoginForm = !!document.querySelector('form[action*="login"], input[name="email"], input[name="pass"]');
        return /\/login(?:\/|\?|$)|checkpoint|two_factor|two_step_verification/i.test(href) ||
          hasLoginForm ||
          /تسجيل الدخول|log in|checkpoint|تأكيد الهوية|تحقق أمني/i.test(body);
      }).catch(() => false);
      if (blocked) throw new Error("SESSION_EXPIRED: Facebook طلب تسجيل دخول أو تحقق أثناء فتح Business Suite.");
      const html = await page.content().catch(() => "");
      for (const token of extractTokensFromText(html)) inspector.tokens.add(token);
      const storageDump = await page.evaluate(() => {
        const values = [];
        try {
          for (let i = 0; i < localStorage.length; i += 1) values.push(localStorage.getItem(localStorage.key(i)) || "");
          for (let i = 0; i < sessionStorage.length; i += 1) values.push(sessionStorage.getItem(sessionStorage.key(i)) || "");
        } catch (_) {}
        return values.join("\n").slice(0, 1_000_000);
      }).catch(() => "");
      for (const token of extractTokensFromText(storageDump)) inspector.tokens.add(token);
    }, { retries: 0, timeoutMs: perUrlTimeoutMs + (skipReactReady ? 0 : readyTimeoutMs) + 3_000 }).catch((error) => emitPipelineLog(report, "token_probe", "failed", "فشل فتح مصدر توكن", { url, error: shortError(error) }));

    const token = inspector.tokenList()[0];
    if (token) {
      await emitPipelineLog(report, "token_extract", "ok", "تم العثور على توكن Graph من الشبكة/الجلسة", { source_index: i + 1 });
      return { token, inspector };
    }
  }
  await emitPipelineLog(report, "token_extract", "failed", "لم يتم العثور على توكن Graph داخل الجلسة", { payloads: inspector.payloadCount() });
  return { token: null, inspector };
}

async function listManagedPagesFromGraph(userToken, report) {
  return runStage(report, "discover_pages", "جلب الصفحات المدارة من Graph API", async () => {
    const map = new Map();
    let path = "/me/accounts?fields=id,name,category,access_token,tasks,picture.type(square){url}&limit=100";
    for (let i = 0; i < 10 && path; i += 1) {
      const res = await fbGet(path, userToken);
      for (const raw of res?.data || []) {
        const id = String(raw?.id || "").trim();
        const name = cleanName(raw?.name || "");
        if (!/^\d{5,}$/.test(id) || !isRealName(name)) continue;
        map.set(id, {
          id,
          name,
          category: raw.category || null,
          access_token: raw.access_token || null,
          tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
          avatar_url: raw.picture?.data?.url || null,
        });
      }
      path = res?.paging?.next || null;
      if (path) {
        const idx = path.indexOf("graph.facebook.com/");
        path = idx >= 0 ? "/" + path.slice(idx + "graph.facebook.com/".length).replace(/^v\d+\.\d+\//, "").replace(/[?&]access_token=[^&]+/g, "") : null;
      }
    }
    const pages = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
    if (pages.length === 0) throw new Error("Graph API لم يرجع أي صفحة مدارة باسم صحيح.");
    await emitPipelineLog(report, "discover_pages", "ok", `تم اكتشاف ${pages.length} صفحة مدارة`, {
      count: pages.length,
      sample: pages.slice(0, 5).map((p) => ({ id: p.id, name: p.name })),
    });
    return pages;
  }, { retries: 1, timeoutMs: 35_000 });
}

async function validatePageAccessFromGraph(userToken, pageId, report) {
  const pages = await listManagedPagesFromGraph(userToken, report);
  const page = pages.find((p) => String(p.id) === String(pageId));
  if (!page) {
    throw new Error(`الحساب لا يدير الصفحة المختارة (${pageId}) حسب Graph API.`);
  }
  if (!page.access_token) {
    throw new Error(`لا يوجد Page Token للصفحة ${page.name}. أعد ربط الحساب بصلاحية الصفحات.`);
  }
  await emitPipelineLog(report, "validate_page_access", "ok", "تم تأكيد ملكية الصفحة وصلاحية الوصول", {
    page_id: page.id,
    page_name: page.name,
    tasks: page.tasks,
  });
  return page;
}

async function openBusinessInbox(page, pageId, pageName, report) {
  return runStage(report, "open_inbox", "فتح Inbox الصفحة داخل Business Suite", async () => {
    let lastSnapshot = null;
    for (const url of BUSINESS_INBOX_URLS(pageId)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35_000 });
      await waitForReactReady(page, report, "inbox_react_ready", 12_000).catch(() => null);
      const snapshot = await page.evaluate((expectedPageId) => {
        const u = new URL(location.href);
        const params = u.searchParams;
        const selected = params.get("asset_id") || params.get("mailbox_id") || params.get("page_id") || "";
        const body = (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 2000);
        return {
          url: location.href,
          selected,
          onBusiness: /(^|\.)business\.facebook\.com$/i.test(location.hostname),
          inInbox: /\/latest\/inbox/i.test(location.pathname),
          selectedMatches: selected === String(expectedPageId),
          loginLike: /\/login|checkpoint/i.test(location.href) || /تسجيل الدخول|log in|checkpoint/i.test(body),
          noAccess: /permission|not available|ليس لديك|غير متاح|صلاحية|إذن/i.test(body),
        };
      }, String(pageId));
      lastSnapshot = snapshot;
      if (snapshot.loginLike) throw new Error("SESSION_EXPIRED: Facebook طلب تسجيل دخول/تحقق عند فتح Business Suite.");
      if (snapshot.noAccess) throw new Error(`الحساب لا يملك صلاحية Inbox لهذه الصفحة (${pageName || pageId}).`);
      if (snapshot.onBusiness && snapshot.inInbox && snapshot.selectedMatches) return snapshot;
    }
    throw new Error(`لم نستطع تأكيد أن Inbox المفتوح تابع للصفحة المختارة. آخر رابط: ${lastSnapshot?.url || "غير معروف"}`);
  }, { retries: 1, timeoutMs: 80_000 });
}

function normalizeProfileUrl(value) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (!/facebook\.com|fb\.com|messenger\.com/i.test(url)) return null;
  if (/scontent|\/photo\.|safe_image|emoji|static/i.test(url)) return null;
  return url.slice(0, 1000);
}

function normalizeNetworkCandidate(raw, pageId, pageName) {
  if (!raw || typeof raw !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = raw[key];
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
    return "";
  };
  const id = pick("id", "user_id", "participant_id", "profile_id", "actor_id", "messaging_actor_id", "other_user_id", "fbid");
  const name = cleanName(pick("name", "short_name", "display_name", "title", "text"));
  if (!/^\d{5,}$/.test(id) || id === String(pageId)) return null;
  if (!isRealName(name) || cleanName(pageName) === name) return null;
  const profileUrl = normalizeProfileUrl(pick("profile_url", "url", "uri", "profile_uri", "permalink_url"));
  const picture = raw.profile_pic_url || raw.profile_picture?.uri || raw.profile_picture?.url || raw.image?.uri || raw.avatar?.uri || null;
  return {
    psid: id,
    full_name: name,
    conversation_id: pick("thread_id", "thread_fbid", "message_thread_id", "conversation_id") || null,
    profile_pic_url: typeof picture === "string" && /^https?:\/\//i.test(picture) ? picture : null,
    profile_url: profileUrl,
    source: "business_network",
  };
}

function collectBusinessNetworkContacts(inspector, pageId, pageName, max = 5000) {
  const contacts = new Map();
  const seenObjects = new WeakSet();
  const interestingPathRe = /(participant|actor|user|contact|thread|message|messenger|inbox)/i;

  const visit = (node, path = "") => {
    if (!node || contacts.size >= max) return;
    if (typeof node !== "object") return;
    if (seenObjects.has(node)) return;
    seenObjects.add(node);

    if (!Array.isArray(node)) {
      const candidate = interestingPathRe.test(path) ? normalizeNetworkCandidate(node, pageId, pageName) : null;
      if (candidate && !contacts.has(candidate.psid)) contacts.set(candidate.psid, candidate);
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item, path);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const nextPath = `${path}.${key}`;
      if (value && typeof value === "object") visit(value, nextPath);
    }
  };

  for (const payload of inspector.payloads) visit(payload.json, payload.source || "payload");
  return Array.from(contacts.values()).slice(0, max);
}

async function extractConversationsViaGraph(pageToken, pageId, pageName, maxConversations, report) {
  return runStage(report, "extract_conversations_graph", "استخراج المحادثات عبر Graph API", async () => {
    const contacts = new Map();
    let conversations = 0;
    let nextPath = `/${encodeURIComponent(pageId)}/conversations?fields=id,updated_time,snippet,message_count,unread_count,participants{id,name,email}&limit=100`;
    for (let pageNo = 0; pageNo < 100 && nextPath && conversations < maxConversations; pageNo += 1) {
      const res = await fbGet(nextPath, pageToken);
      const rows = Array.isArray(res?.data) ? res.data : [];
      if (rows.length === 0) break;
      for (const conv of rows) {
        conversations += 1;
        const participants = conv?.participants?.data || [];
        const others = participants.filter((p) => String(p?.id || "") !== String(pageId));
        for (const p of others) {
          const psid = String(p?.id || "").trim();
          const name = cleanName(p?.name || "");
          if (!/^\d{5,}$/.test(psid) || !isRealName(name)) continue;
          if (!contacts.has(psid)) {
            contacts.set(psid, {
              psid,
              full_name: name,
              conversation_id: conv.id || null,
              profile_pic_url: `https://graph.facebook.com/${encodeURIComponent(psid)}/picture?type=normal`,
              profile_url: null,
              last_message_at: conv.updated_time || null,
              messages_count: conv.message_count || 0,
              unread_count: conv.unread_count || 0,
              last_message_preview: conv.snippet || null,
              source: "graph_api",
            });
          }
        }
      }
      if (contacts.size >= maxConversations) break;
      const next = res?.paging?.next;
      if (!next) break;
      const idx = next.indexOf("graph.facebook.com/");
      nextPath = idx >= 0 ? "/" + next.slice(idx + "graph.facebook.com/".length).replace(/^v\d+\.\d+\//, "").replace(/[?&]access_token=[^&]+/g, "") : null;
      if (typeof report === "function") {
        await report({ status: "running", progress: Math.min(90, 20 + Math.round((contacts.size / Math.max(maxConversations, 1)) * 70)), processedItems: contacts.size, totalItems: contacts.size });
      }
    }
    await emitPipelineLog(report, "extract_conversations_graph", "ok", `Graph API أعاد ${conversations} محادثة و ${contacts.size} عميل`, {
      conversations,
      contacts: contacts.size,
      page_id: pageId,
      page_name: pageName,
    });
    return { conversations, contacts: Array.from(contacts.values()).slice(0, maxConversations) };
  }, { retries: 1, timeoutMs: 95_000 });
}

async function extractConversationsViaBusinessNetwork(page, pageId, pageName, maxConversations, report) {
  const inspector = createMetaNetworkInspector(page);
  await openBusinessInbox(page, pageId, pageName, report);
  await runStage(report, "network_hydration", "تحميل بيانات المحادثات من شبكة Business Suite", async () => {
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel({ deltaY: 900 });
      await sleep(900);
      await page.keyboard.press("PageDown").catch(() => null);
      await sleep(500);
    }
  }, { retries: 0, timeoutMs: 18_000 });
  const contacts = collectBusinessNetworkContacts(inspector, pageId, pageName, maxConversations);
  await emitPipelineLog(report, "extract_conversations_network", contacts.length ? "ok" : "failed", `Network payloads أعادت ${contacts.length} عميل`, {
    payloads: inspector.payloadCount(),
    contacts: contacts.length,
  });
  return { conversations: contacts.length, contacts };
}

function dedupeAndValidateContacts(contacts, pageId, pageName) {
  const map = new Map();
  for (const c of contacts || []) {
    const psid = String(c?.psid || "").trim();
    const name = cleanName(c?.full_name || "");
    if (!/^\d{5,}$/.test(psid) || psid === String(pageId)) continue;
    if (!isRealName(name)) continue;
    if (!map.has(psid)) {
      map.set(psid, {
        psid,
        full_name: name,
        conversation_id: c.conversation_id || null,
        profile_pic_url: c.profile_pic_url || null,
        profile_url: c.profile_url || null,
        last_message_at: c.last_message_at || null,
        messages_count: c.messages_count || 0,
        unread_count: c.unread_count || 0,
        last_message_preview: c.last_message_preview || null,
        page_id: String(pageId),
        page_name: pageName || null,
        source: c.source || "stable_pipeline",
      });
    }
  }
  return Array.from(map.values());
}

module.exports = {
  cleanName,
  isRealName,
  emitPipelineLog,
  runStage,
  createMetaNetworkInspector,
  waitForReactReady,
  extractGraphTokenFromSession,
  listManagedPagesFromGraph,
  validatePageAccessFromGraph,
  openBusinessInbox,
  extractConversationsViaGraph,
  extractConversationsViaBusinessNetwork,
  dedupeAndValidateContacts,
  fbGet,
  shortError,
};