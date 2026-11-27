/*
 * NAS 迅雷下载按钮（可复用库）
 *
 * 这是一个 @require 库文件，不是独立脚本。在你的油猴脚本头部加入：
 *   // @require   https://raw.githubusercontent.com/Elijah-Neverdie/bts_web_tool/main/lib/nas-xunlei-button.lib.js
 *   // @grant     GM_setValue
 *   // @grant     GM_getValue
 *   // @grant     GM_deleteValue
 *   // @grant     GM_xmlhttpRequest
 *   // @grant     GM_openInTab
 *   // @grant     GM_addValueChangeListener
 *   // @grant     GM_removeValueChangeListener
 *   // @connect   *
 *   // @include   http://10.144.0.1:2345/webman/3rdparty/pan-xunlei-com/index.cgi/*
 *   （引擎页那一行必须有：宿主脚本在引擎页加载本库，后台任务才能被领取执行）
 *
 * 使用：
 *   new NasXunleiButton({
 *     name: 'Download To Nas',            // 按钮文字
 *     color: '#1c1b19',                   // 按钮主色（边框、文字；悬停时填充）
 *     size: 'small' | 'medium' | 'large', // 或 { minHeight, fontSize, padding }
 *     position: { target: '选择器或元素', where: 'afterend' }, // where: afterend | beforebegin | afterbegin | beforeend
 *     downloadLink: '磁力链接' 或 () => '磁力链接'            // 点击时读取
 *   }).mount();
 *
 * 方法：mount() / destroy() / setName() / setColor() / setSize() / setDownloadLink()
 * 交互：点击 = 后台静默提交；Ctrl+点击 = 打开 NAS 迅雷网页；右键或长按 = 设置（IP、账号、密码）
 */
(function () {
  'use strict';
  if (window.NasXunleiButton) return; // 防止重复加载

  const ENGINE_PORT = 2345;
  const ENGINE_PATH = '/webman/3rdparty/pan-xunlei-com/index.cgi/#/home';
  const ENGINE_PATH_RE = /\/webman\/3rdparty\/pan-xunlei-com\/index\.cgi\//;
  const CANDIDATE_IPS = ['10.10.10.10', '10.144.0.1'];
  const CFG_KEY = 'nas_cfg';
  // 版本号：通信键名按版本区分，旧版引擎标签只监听旧键名，收不到新任务，不会再“抢”任务并绕过新规则
  const VERSION = '2.0.2';
  const CH = VERSION.replace(/\./g, '_');
  const JOB_KEY = 'nas_job_' + CH;
  const RESULT_KEY = 'nas_result_' + CH;
  const ACK_KEY = 'nas_ack_' + CH;
  const WORKER_KEY = 'nas_worker_' + CH;
  const WORKER_FLAG = 'btsow_worker_' + CH;
  const ACK_TIMEOUT_MS = 900;
  const IDLE_CLOSE_MS = 10 * 60 * 1000;
  // 引擎页状态变量必须在 runEngine() 被调用之前声明（否则触发 TDZ 错误）
  // 只下载视频：这些扩展名视为视频；视频占默认勾选总大小的比例达到该值才下载
  const VIDEO_EXT = new Set(['mp4', 'mkv', 'avi', 'wmv', 'mov', 'flv', 'ts', 'm2ts', 'mts', 'rmvb', 'rm', 'mpg', 'mpeg', 'm4v', 'webm', '3gp', 'vob', 'asf', 'f4v', 'ogv', 'divx']);
  const MIN_VIDEO_RATIO = 0.45;
  // 所有视频都小于该值：下载默认勾选的全部文件
  const SMALL_ALL_BYTES = 50 * 1024 * 1024;
  // 视频体积相对最大视频不足该比例：视为广告小片，排除
  const SMALL_VIDEO_RATIO = 0.10;
  let engineBusy = false;
  let engineWorker = false;
  let idleTimer = null;
  const JOB_TTL_MS = 5 * 60 * 1000;
  const JOB_TIMEOUT_MS = 120 * 1000;
  const BTN_TEXT = 'Download To Nas';
  // ---------- NAS 配置 ----------

  function getCfg() {
    let cfg = {};
    try { cfg = JSON.parse(GM_getValue(CFG_KEY, '{}')) || {}; } catch (e) { cfg = {}; }
    return { ip: cfg.ip || '', user: cfg.user || '', pass: cfg.pass || '' };
  }

  function saveCfg(cfg) {
    GM_setValue(CFG_KEY, JSON.stringify(cfg));
  }

  function hostForUrl(ip) {
    const v = String(ip || '').trim();
    if (v.indexOf(':') !== -1 && v.charAt(0) !== '[') return '[' + v + ']';
    return v;
  }

  function engineBase(ip) {
    return 'http://' + hostForUrl(ip) + ':' + ENGINE_PORT;
  }

  // 地址里绝不带账号密码：Edge 对带凭据的 URL 会让页面空白（接口请求直接失败）。
  // 认证交给浏览器的 Basic 认证弹窗，首次使用时由用户 Ctrl+点击输入一次，浏览器会记住。
  function engineUrl(cfg) {
    return 'http://' + hostForUrl(cfg.ip) + ':' + ENGINE_PORT + ENGINE_PATH;
  }

  function probeIp(ip, timeoutMs) {
    return new Promise(function (resolve) {
      const started = Date.now();
      let done = false;
      const finish = function (ok) {
        if (done) return;
        done = true;
        resolve({ ip: ip, ok: ok, ms: Date.now() - started });
      };
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: engineBase(ip) + '/',
          timeout: timeoutMs,
          anonymous: true,
          onload: function () { finish(true); },
          onerror: function () { finish(false); },
          ontimeout: function () { finish(false); }
        });
      } catch (e) {
        finish(false);
      }
    });
  }

  // 并发探测候选 IP，挑选延迟最低且可连通的
  async function detectIp() {
    const results = await Promise.all(CANDIDATE_IPS.map(function (ip) { return probeIp(ip, 2500); }));
    const ok = results.filter(function (r) { return r.ok; }).sort(function (a, b) { return a.ms - b.ms; });
    return { best: ok.length ? ok[0].ip : '', results: results };
  }

  function verifyLogin(cfg) {
    return new Promise(function (resolve) {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: engineBase(cfg.ip) + '/webman/3rdparty/pan-xunlei-com/index.cgi/',
          user: cfg.user,
          password: cfg.pass,
          anonymous: true,
          timeout: 6000,
          onload: function (r) {
            if (r.status >= 200 && r.status < 400) return resolve({ ok: true });
            resolve({ ok: false, message: 'HTTP ' + r.status + (r.status === 401 ? '（账号或密码错误）' : '') });
          },
          onerror: function () { resolve({ ok: false, message: '无法连接 ' + cfg.ip }); },
          ontimeout: function () { resolve({ ok: false, message: '连接超时' }); }
        });
      } catch (e) {
        resolve({ ok: false, message: String(e && e.message || e) });
      }
    });
  }

  // ---------- btsow 页面：提示与设置界面 ----------

  function toast(text, kind, ms) {
    if (!document.body) return;
    const el = document.createElement('div');
    el.className = 'nasxl-toast' + (kind ? ' is-' + kind : '');
    el.textContent = text;
    document.body.appendChild(el);
    window.setTimeout(function () {
      el.classList.add('is-out');
      window.setTimeout(function () { el.remove(); }, 300);
    }, ms || 3800);
  }

  function formatDetect(results) {
    return results.map(function (r) {
      return r.ip + (r.ok ? '  ' + r.ms + 'ms' : '  不通');
    }).join('\n');
  }

  function openSettings() {
    if (document.getElementById('nasxl-nas-dialog')) return;
    const cfg = getCfg();
    const wrap = document.createElement('div');
    wrap.id = 'nasxl-nas-dialog';
    wrap.className = 'nasxl-dialog';
    wrap.innerHTML =
      '<div class="nasxl-dialog__box" role="dialog" aria-label="NAS 迅雷设置">' +
      '<div class="nasxl-dialog__title">NAS 迅雷设置</div>' +
      '<label class="nasxl-dialog__label">NAS IP</label>' +
      '<div class="nasxl-dialog__row">' +
      '<input class="nasxl-dialog__input" data-f="ip" placeholder="留空则自动检测延迟最低的 IP" autocomplete="off">' +
      '<button type="button" class="nasxl-dialog__btn" data-a="detect">检测</button>' +
      '</div>' +
      '<div class="nasxl-dialog__hint" data-r="detect"></div>' +
      '<label class="nasxl-dialog__label">账号</label>' +
      '<input class="nasxl-dialog__input" data-f="user" autocomplete="off">' +
      '<label class="nasxl-dialog__label">密码</label>' +
      '<input class="nasxl-dialog__input" data-f="pass" type="password" autocomplete="new-password">' +
      '<div class="nasxl-dialog__hint" data-r="verify"></div>' +
      '<div class="nasxl-dialog__actions">' +
      '<button type="button" class="nasxl-dialog__btn" data-a="cancel">取消</button>' +
      '<button type="button" class="nasxl-dialog__btn is-primary" data-a="save">验证并保存</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    const field = function (name) { return wrap.querySelector('[data-f="' + name + '"]'); };
    const hint = function (name) { return wrap.querySelector('[data-r="' + name + '"]'); };
    const saveBtn = wrap.querySelector('[data-a="save"]');
    field('ip').value = cfg.ip;
    field('user').value = cfg.user;
    field('pass').value = cfg.pass;
    let forceSave = false;

    const close = function () {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
    };
    const onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey, true);

    const doDetect = async function () {
      hint('detect').textContent = '检测中…';
      const d = await detectIp();
      hint('detect').textContent = formatDetect(d.results);
      if (d.best) field('ip').value = d.best;
      return d.best;
    };

    wrap.addEventListener('click', async function (e) {
      if (e.target === wrap) return close();
      const action = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (!action) return;
      e.preventDefault();
      if (action === 'cancel') return close();
      if (action === 'detect') return doDetect();
      if (action === 'save') {
        let ip = field('ip').value.trim();
        const next = { ip: ip, user: field('user').value.trim(), pass: field('pass').value };
        if (!forceSave) {
          saveBtn.disabled = true;
          if (!next.ip) {
            next.ip = await doDetect();
            if (!next.ip) {
              hint('verify').textContent = '未检测到可连通的 NAS，请手动填写 IP';
              saveBtn.disabled = false;
              return;
            }
          }
          if (next.user) {
            hint('verify').textContent = '验证账号中…';
            const v = await verifyLogin(next);
            if (!v.ok) {
              hint('verify').textContent = '验证失败：' + v.message + '。再次点击将仍然保存。';
              saveBtn.textContent = '仍然保存';
              saveBtn.disabled = false;
              forceSave = true;
              return;
            }
          }
        }
        saveCfg(next);
        close();
        toast('NAS 设置已保存：' + (next.ip || '未设置 IP'));
      }
    });
  }

  // ---------- btsow 页面：下载按钮 ----------

  function setBusy(button, busy) {
    window.clearInterval(button._tick);
    if (busy) {
      const since = Date.now();
      button.disabled = true;
      button.dataset.state = 'loading';
      const render = function () {
        button.textContent = '等待 NAS 响应… ' + ((Date.now() - since) / 1000).toFixed(1) + 's';
      };
      render();
      button._tick = window.setInterval(render, 100);
    } else {
      button.disabled = false;
      button.dataset.state = '';
      button.textContent = button._nasxlName || BTN_TEXT;
    }
  }

  function fmtSec(ms) {
    return (Math.max(0, ms) / 1000).toFixed(1) + 's';
  }

  // 把引擎页回传的分段耗时整理成一行，便于看时间花在哪
  function describeTiming(res, startedAt, total) {
    const m = res.marks || {};
    const parts = ['总计 ' + fmtSec(total)];
    if (res.pickedAt) {
      parts.push('等待引擎 ' + fmtSec(res.pickedAt - startedAt) + (res.reused ? '（复用标签）' : '（新开标签）'));
    }
    if (m.ready != null) parts.push('页面就绪 ' + fmtSec(m.ready));
    if (m.list != null && m.ready != null) parts.push('读取列表 ' + fmtSec(m.list - m.ready));
    if (m.dialog != null && m.list != null) parts.push('填写链接 ' + fmtSec(m.dialog - m.list));
    if (m.outcome != null && m.dialog != null) parts.push('等待迅雷响应 ' + fmtSec(m.outcome - m.dialog));
    if (m.filter != null && m.outcome != null) parts.push('筛选视频 ' + fmtSec(m.filter - m.outcome));
    if (m.click != null) {
      const from = m.filter != null ? m.filter : m.outcome;
      if (from != null) parts.push('点击立即下载并等待结果 ' + fmtSec(m.click - from));
    }
    if (res.engineMs != null && m.done != null) parts.push('收尾 ' + fmtSec(res.engineMs - m.done));
    else if (res.engineMs != null && m.outcome != null) parts.push('收尾 ' + fmtSec(res.engineMs - m.outcome));
    return parts.join(' ｜ ');
  }

  function dispatchSilentJob(cfg, magnet) {
    return new Promise(function (resolve, reject) {
      const id = String(Date.now()) + Math.random().toString(16).slice(2, 8);
      let resultListener = null;
      let ackListener = null;
      let timer = null;
      let ackTimer = null;
      let acked = false;
      const removeListener = function (l) {
        try { if (l !== null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(l); } catch (e) { /* ignore */ }
      };
      const cleanup = function () {
        window.clearTimeout(timer);
        window.clearTimeout(ackTimer);
        removeListener(resultListener);
        removeListener(ackListener);
      };
      const openEngineTab = function () {
        // 新开的引擎标签页加载完成后会领取任务，并保持打开，供下次直接复用
        GM_openInTab(engineUrl(cfg), { active: false, insert: true });
      };

      timer = window.setTimeout(function () {
        cleanup();
        reject(new Error('等待 NAS 迅雷响应超时（' + Math.round(JOB_TIMEOUT_MS / 1000) + ' 秒）。请确认 NAS 在线；如果是首次使用，请先 Ctrl+点击按钮，在弹出的登录框输入账号密码一次。'));
      }, JOB_TIMEOUT_MS);

      resultListener = GM_addValueChangeListener(RESULT_KEY, function (name, oldValue, newValue) {
        let res = null;
        try { res = JSON.parse(newValue); } catch (e) { return; }
        if (!res || res.id !== id) return;
        cleanup();
        if (res.status === 'error') {
          const err = new Error(res.message || '未知错误');
          err.needVerify = !!res.needVerify;
          reject(err);
        } else {
          resolve(res);
        }
      });

      ackListener = GM_addValueChangeListener(ACK_KEY, function (name, oldValue, newValue) {
        let ack = null;
        try { ack = JSON.parse(newValue); } catch (e) { return; }
        if (ack && ack.id === id) {
          acked = true;
          window.clearTimeout(ackTimer);
        }
      });

      GM_setValue(JOB_KEY, JSON.stringify({ id: id, magnet: magnet, mode: 'silent', ts: Date.now(), v: VERSION }));

      // 最近有引擎标签页活动过：先等它领取任务（事件驱动，通常几十毫秒）；否则直接新开
      const lastActive = Number(GM_getValue(WORKER_KEY, 0)) || 0;
      if (Date.now() - lastActive < IDLE_CLOSE_MS) {
        ackTimer = window.setTimeout(function () {
          if (!acked) openEngineTab();
        }, ACK_TIMEOUT_MS);
      } else {
        openEngineTab();
      }
    });
  }

  async function onNasClick(button, event, magnet) {
    if (button.disabled) return;
    magnet = String(magnet || '').trim();
    if (!/^magnet:\?/.test(magnet)) {
      toast('无磁力链接', 'error');
      return;
    }
    const visible = !!(event.ctrlKey || event.metaKey);
    const startedAt = Date.now();
    const cfg = getCfg();
    setBusy(button, true);
    try {
      if (!cfg.ip) {
        toast('正在检测 NAS IP…');
        const d = await detectIp();
        if (!d.best) {
          throw new Error('未检测到可连通的 NAS（已尝试 ' + CANDIDATE_IPS.join('、') + '）。请右键按钮手动设置 IP。\n' + formatDetect(d.results));
        }
        cfg.ip = d.best;
        saveCfg(cfg);
        toast('已选择延迟最低的 NAS：' + cfg.ip);
      }
      if (!cfg.user || !cfg.pass) {
        setBusy(button, false);
        toast('请先设置 NAS 迅雷的账号和密码', 'error');
        openSettings();
        return;
      }

      if (visible) {
        // Ctrl+点击：在前台打开 NAS 迅雷网页，并自动填入磁力
        GM_setValue(JOB_KEY, JSON.stringify({ id: String(Date.now()), magnet: magnet, mode: 'visible', ts: Date.now() }));
        GM_openInTab(engineUrl(cfg), { active: true, insert: true });
        setBusy(button, false);
        return;
      }

      const res = await dispatchSilentJob(cfg, magnet);
      const total = Date.now() - startedAt;
      const detail = describeTiming(res, startedAt, total);
      const secs = (total / 1000).toFixed(1);
      const cost = '用时 ' + secs + ' 秒' + (res.reused ? '（复用引擎标签）' : '（新开引擎标签）');
      console.info('[BTSOW v' + VERSION + '] 提交耗时：' + detail);
      setBusy(button, false);
      button.title = detail;
      if (res.status === 'skipped') {
        toast('已跳过，未下载\n' + res.message + '\n' + cost + ' ｜ v' + VERSION, 'warn', 10000);
      } else if (res.unfiltered) {
        button.dataset.state = 'ok';
        button.textContent = 'NAS迅雷正在下载 · ' + secs + 's';
        toast('已添加，但未做视频筛选\n' + res.message + '\n' + cost + ' ｜ v' + VERSION, 'warn', 12000);
      } else if (res.status === 'exists') {
        toast('已有该任务，当前进度 ' + (res.progress || '未知') + '\n' + cost + ' ｜ v' + VERSION + '\n' + detail, 'ok', 9000);
      } else {
        const f = res.filter;
        let filterLine = '';
        if (f && f.mode === 'all') {
          filterLine = '\n视频都小于 50MB，已下载默认勾选的全部 ' + f.checkedCount + ' 个文件';
        } else if (f) {
          filterLine = '\n仅下载视频 ' + f.videoCount + ' 个（' + fmtBytes(f.videoBytes) + '，占默认勾选 ' + (f.ratio * 100).toFixed(1) + '%）' +
            (f.unchecked ? '，已排除 ' + f.unchecked + ' 个非视频或小广告片' : '');
        }
        button.dataset.state = 'ok';
        button.textContent = 'NAS迅雷正在下载 · ' + secs + 's';
        toast('NAS迅雷正在下载' + filterLine + '\n' + cost + ' ｜ v' + VERSION + '\n' + detail, 'ok', 9000);
      }
    } catch (error) {
      setBusy(button, false);
      const reason = error && error.message ? error.message : String(error);
      console.error('[BTSOW] NAS下载失败：', reason);
      window.alert('NAS下载失败\n原因：' + reason + '\n用时 ' + ((Date.now() - startedAt) / 1000).toFixed(1) + ' 秒（v' + VERSION + '）');
    }
  }
  // ---------- NAS 迅雷引擎页（后台标签页执行） ----------

  // 事件驱动等待：DOM 一有变化就立刻检查。后台标签页的定时器会被浏览器限流到约 1 秒，不能只靠轮询
  function waitFor(getter, timeoutMs) {
    return new Promise(function (resolve) {
      let done = false;
      let observer = null;
      let poll = null;
      let timeout = null;
      const finish = function (value) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        window.clearInterval(poll);
        window.clearTimeout(timeout);
        resolve(value);
      };
      const check = function () {
        if (done) return;
        let value = null;
        try { value = getter(); } catch (e) { value = null; }
        if (value) finish(value);
      };
      check();
      if (done) return;
      observer = new MutationObserver(check);
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      poll = window.setInterval(check, 200);
      timeout = window.setTimeout(function () { finish(null); }, timeoutMs);
    });
  }

  function findByText(text) {
    return [...document.querySelectorAll('button, span, div, a')].find(function (el) {
      return el.textContent.trim() === text && el.offsetParent !== null;
    }) || null;
  }

  function setTextareaValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 前台模式下的常驻日志面板：每一步追加一行，点击面板可关闭
  function notifyEngine(text) {
    console.log('[BTSOW engine]', text);
    if (!document.body) return;
    let panel = document.getElementById('btsow-engine-log');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'btsow-engine-log';
      panel.title = '点击关闭';
      panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:999999;max-width:380px;background:#1c1b19;color:#f3f2ee;padding:10px 14px;font:12px/1.7 sans-serif;cursor:pointer;';
      panel.addEventListener('click', function () { panel.remove(); });
      document.body.appendChild(panel);
    }
    const line = document.createElement('div');
    line.textContent = text;
    panel.appendChild(line);
  }

  function pageToastText() {
    const el = document.querySelector('.el-message, .el-notification, .el-message-box');
    return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '';
  }

  // 读取「下载中」和「已完成」两个列表的文字，用于判断任务是否已存在
  async function readKnownTasks() {
    let text = '';
    for (const label of ['下载中', '已完成']) {
      const tab = [...document.querySelectorAll('span, div, a, li')].find(function (el) {
        const t = el.textContent.trim().replace(/\s+/g, '');
        return el.offsetParent !== null && el.children.length <= 1 && t.indexOf(label) === 0 && t.length <= label.length + 4;
      });
      if (tab) {
        // 点击标签后，页面文字一变化就继续；不变化最多等 400ms（原来固定等 900ms）
        const before = document.body.innerText.length;
        tab.click();
        await waitFor(function () { return document.body.innerText.length !== before; }, 400);
      }
      text += '\n' + document.body.innerText;
    }
    return text;
  }

  function findDuplicate(dialogText, magnet, known) {
    const cands = [];
    const dn = (magnet.match(/[?&]dn=([^&]+)/) || [])[1];
    if (dn) {
      try { cands.push(decodeURIComponent(dn).replace(/\+/g, ' ').trim()); } catch (e) { /* ignore */ }
    }
    // 只用磁力自己的任务名（dn）精确匹配。不能用弹窗里的每一行文字：磁力文件列表里常有广告文件名，会和别的任务同名而误判
    for (const cand of cands) {
      if (cand.length < 8) continue;
      const idx = known.indexOf(cand);
      if (idx === -1) continue;
      const tail = known.slice(idx + cand.length, idx + cand.length + 160);
      const pct = tail.match(/(\d+(?:\.\d+)?)\s*%/);
      const size = tail.match(/(\d+(?:\.\d+)?\s*[KMGT]?B\s*\/\s*\d+(?:\.\d+)?\s*[KMGT]?B)/i);
      let progress = '未知';
      if (pct) progress = pct[0];
      else if (size) progress = size[1];
      else if (/下载完成|已完成/.test(tail.slice(0, 80))) progress = '已完成';
      else if (/已暂停/.test(tail)) progress = '已暂停';
      return { name: cand, progress: progress };
    }
    return null;
  }

  // 记录引擎页当前状态，用于失败时告诉用户到底卡在哪一步
  function describeEngineState() {
    const app = document.getElementById('app');
    const text = document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '';
    const state = {
      visibility: document.visibilityState,
      readyState: document.readyState,
      appChildren: app ? app.children.length : 'no #app',
      scripts: document.scripts.length,
      text: text.slice(0, 80)
    };
    console.log('[BTSOW engine] page state', state);
    const parts = [
      '可见性=' + state.visibility,
      '加载=' + state.readyState,
      '#app子元素=' + state.appChildren,
      '页面文字=' + (state.text || '(空)')
    ];
    return parts.join('，');
  }

  // ---------- 只下载视频：读取「新建下载任务」弹窗里的文件树 ----------

  function parseSize(text) {
    const m = String(text || '').trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
    if (!m) return 0;
    const unit = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 }[m[2].toUpperCase()];
    return parseFloat(m[1]) * unit;
  }

  function fmtBytes(n) {
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function closeDialogOf(box) {
    const b = box && box.querySelector('.el-dialog__headerbtn');
    if (b) b.click();
  }

  // 文件夹节点默认折叠、子节点不渲染，必须先全部展开才能读到所有文件
  async function expandAllFolders(box) {
    const iconOf = function (n) { return n.querySelector(':scope > .el-tree-node__content .el-tree-node__expand-icon'); };
    for (let round = 0; round < 12; round++) {
      const collapsed = [...box.querySelectorAll('.el-tree-node')].filter(function (n) {
        const icon = iconOf(n);
        return icon && !icon.classList.contains('is-leaf') && !n.classList.contains('is-expanded') && !icon.classList.contains('expanded');
      });
      if (!collapsed.length) return;
      collapsed.forEach(function (n) { iconOf(n).click(); });
      await waitFor(function () {
        return collapsed.every(function (n) { return n.classList.contains('is-expanded') || iconOf(n).classList.contains('expanded'); });
      }, 1500);
    }
  }

  function collectLeaves(box) {
    return [...box.querySelectorAll('.el-tree-node')].map(function (n) {
      const content = n.querySelector(':scope > .el-tree-node__content');
      if (!content) return null;
      const icon = content.querySelector('.el-tree-node__expand-icon');
      if (icon && !icon.classList.contains('is-leaf')) return null; // 文件夹本身不计入
      const title = content.querySelector('.file_title');
      const type = content.querySelector('.file_type');
      const size = content.querySelector('.file_size');
      const name = title ? (title.getAttribute('title') || title.textContent || '') : '';
      const ext = (((type && type.textContent.trim()) || (name.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '') + '').toLowerCase();
      return {
        node: n,
        input: content.querySelector('.el-checkbox__original'),
        name: name,
        ext: ext,
        bytes: parseSize(size ? size.textContent : ''),
        checked: n.classList.contains('is-checked')
      };
    }).filter(Boolean);
  }

  // 规则：只保留默认勾选里的视频文件；视频体积占「默认勾选文件总大小」不足 MIN_VIDEO_RATIO 时整体不下载
  async function applyVideoFilter(box) {
    const treeReady = await waitFor(function () { return box.querySelector('.el-tree-node'); }, 10000);
    if (!treeReady) return { error: '未能读取弹窗里的文件列表，已停止（未下载）' };
    await expandAllFolders(box);

    const leaves = collectLeaves(box);
    if (!leaves.length) return { error: '文件列表为空或结构无法识别，已停止（未下载）' };

    const sum = function (list) { return list.reduce(function (s, l) { return s + l.bytes; }, 0); };
    const checked = leaves.filter(function (l) { return l.checked; });
    const videos = checked.filter(function (l) { return VIDEO_EXT.has(l.ext); });
    const others = checked.filter(function (l) { return !VIDEO_EXT.has(l.ext); });
    const totalBytes = sum(checked);
    const videoBytes = sum(videos);
    const ratio = totalBytes > 0 ? videoBytes / totalBytes : 0;
    const stats = {
      fileCount: leaves.length,
      checkedCount: checked.length,
      videoCount: videos.length,
      totalBytes: totalBytes,
      videoBytes: videoBytes,
      ratio: ratio
    };
    console.log('[BTSOW engine] 文件筛选', stats, leaves.map(function (l) { return [l.name, l.ext, l.bytes, l.checked]; }));

    if (!videos.length) return { skip: '默认勾选的文件里没有视频', stats: stats };
    if (ratio < MIN_VIDEO_RATIO) {
      return {
        skip: '视频 ' + fmtBytes(videoBytes) + '，仅占默认勾选总大小 ' + fmtBytes(totalBytes) + ' 的 ' + (ratio * 100).toFixed(1) + '%（要求 ≥ ' + Math.round(MIN_VIDEO_RATIO * 100) + '%）',
        stats: stats
      };
    }

    // 所有视频都小于 50MB：下载默认勾选的全部文件，不再取消勾选
    const maxVideo = Math.max.apply(null, videos.map(function (v) { return v.bytes; }));
    if (maxVideo < SMALL_ALL_BYTES) {
      stats.mode = 'all';
      return { ok: true, stats: stats };
    }

    // 相对最大视频不足 10% 的视频视为广告小片，与非视频文件一起取消勾选
    const tinyLimit = maxVideo * SMALL_VIDEO_RATIO;
    const tiny = videos.filter(function (v) { return v.bytes < tinyLimit; });
    const keepVideos = videos.filter(function (v) { return v.bytes >= tinyLimit; });
    const toUncheck = others.concat(tiny);

    toUncheck.forEach(function (l) { if (l.input) l.input.click(); });
    const done = await waitFor(function () {
      return toUncheck.every(function (l) { return !l.node.classList.contains('is-checked'); });
    }, 3000);
    if (!done) return { error: '取消勾选失败，已停止（未下载）', stats: stats };

    const left = collectLeaves(box).filter(function (l) { return l.checked; });
    if (!left.length || left.some(function (l) { return !VIDEO_EXT.has(l.ext) || l.bytes < tinyLimit; })) {
      return { error: '勾选状态校验失败，已停止（未下载）', stats: stats };
    }
    stats.mode = 'videos';
    stats.videoCount = keepVideos.length;
    stats.videoBytes = sum(keepVideos);
    stats.unchecked = toUncheck.length;
    stats.excluded = toUncheck.map(function (l) { return l.name; });
    return { ok: true, stats: stats };
  }

  async function engineFlow(job, say, finish, mark, reused) {
    say('BTSOW 脚本 v' + VERSION + ' 已收到磁力（' + (job.mode === 'silent' ? (reused ? '后台模式，复用标签' : '后台模式') : '前台模式') + '）');

    const openBtn = await waitFor(function () { return findByText('新建任务'); }, 30000);
    if (!openBtn) {
      const state = describeEngineState();
      const needLogin = /扫码|登录/.test(document.body ? document.body.innerText : '');
      const hint = needLogin
        ? '页面显示了登录界面，请先在 NAS 迅雷网页中登录（Ctrl+点击按钮可打开网页）'
        : '页面没有渲染出迅雷界面（若可见性为 hidden 且 #app 子元素为 0，说明后台标签页未加载，可尝试 Ctrl+点击）';
      return finish('error', hint + '。当前状态：' + state);
    }

    if (reused) await closeStrayDialogs();
    mark('ready');
    const known = await readKnownTasks();
    mark('list');

    openBtn.click();
    const area = await waitFor(function () {
      return document.querySelector('.el-overlay-dialog textarea');
    }, 8000);
    if (!area) return finish('error', '未打开「添加链接」弹窗');
    setTextareaValue(area, job.magnet);

    const dialog = area.closest('.el-overlay-dialog') || document;
    const confirm = await waitFor(function () {
      return [...dialog.querySelectorAll('button')].find(function (b) {
        return b.textContent.trim() === '确定' && !b.disabled && !b.classList.contains('is-disabled');
      }) || null;
    }, 8000);
    if (!confirm) return finish('error', '「确定」不可用：' + (pageToastText() || '磁力链接可能无效'));

    // 下载目录必须是「迅雷测试」：默认目录异步加载，最多等 8 秒
    const folderShown = await waitFor(function () {
      const inputs = [...dialog.querySelectorAll('input')].map(function (i) { return i.value || ''; });
      const shown = (dialog.innerText || '') + ' ' + inputs.join(' ');
      return shown.indexOf('迅雷测试') !== -1 ? shown : null;
    }, 8000);
    if (!folderShown) return finish('error', '下载目录不是「迅雷测试」，已停止');

    say('已填入磁力，目录为「迅雷测试」，点击「确定」');
    mark('dialog');
    confirm.click();

    // 磁力会弹出第二个「新建下载任务」窗口，需要点「立即下载」
    const findStart = function () {
      return [...document.querySelectorAll('button')].find(function (b) {
        return b.textContent.trim() === '立即下载' && b.offsetParent !== null;
      }) || null;
    };
    // 有些磁力会直接「添加成功」而不弹出「立即下载」窗口，这属于成功，不能当失败
    const SUCCESS_RE = /添加成功|提交成功|创建成功/;
    const EXISTS_RE = /已存在|已有该任务/;
    const outcome = await waitFor(function () {
      if (findStart()) return 'start';
      const t = pageToastText();
      if (EXISTS_RE.test(t)) return 'exists';
      if (SUCCESS_RE.test(t)) return 'success';
      return null;
    }, 30000);
    mark('outcome');
    if (!outcome) {
      const verify = /验证/.test(document.body.innerText);
      const msg = pageToastText();
      return finish('error',
        (verify ? '需要验证码：请按住 Ctrl 点击按钮，在网页中完成验证' : '未出现「立即下载」按钮（解析超时）') +
        (msg ? '，页面提示：' + msg : '') + '。当前状态：' + describeEngineState(),
        { needVerify: verify });
    }
    let effective = outcome;
    if (outcome === 'success') {
      // 「添加成功」可能早于「立即下载」窗口出现：再等 2 秒，窗口出现就走筛选，不能跳过
      const late = await waitFor(findStart, 2000);
      effective = late ? 'start' : 'success';
    }
    if (effective === 'success') {
      // 没有文件筛选窗口：迅雷已按默认勾选添加，视频筛选没有生效，必须明确告知
      return finish('ok', '已添加（页面提示：' + pageToastText() + '），但没有出现文件筛选窗口，未做视频筛选，按迅雷默认勾选下载', { unfiltered: true });
    }
    if (outcome === 'exists') {
      // 迅雷提示“已存在”时，只有列表里确实找到同名任务才算已有；否则如实报告，不误导用户
      const d = findDuplicate(document.body.innerText, job.magnet, known);
      if (d) return finish('exists', '已有该任务：' + d.name, { name: d.name, progress: d.progress });
      return finish('error', '迅雷提示「' + pageToastText() + '」，但列表里找不到同名任务，请到迅雷网页确认');
    }
    const startBtn = findStart();

    const box = startBtn.closest('.el-overlay-dialog') || document.body;
    const dup = findDuplicate(box.innerText, job.magnet, known);
    if (dup) {
      const closeBtn = box.querySelector('.el-dialog__headerbtn');
      if (closeBtn) closeBtn.click();
      return finish('exists', '已有该任务：' + dup.name, { name: dup.name, progress: dup.progress });
    }

    const ready = await waitFor(function () {
      return !startBtn.disabled && !startBtn.classList.contains('is-disabled');
    }, 30000);
    if (!ready) return finish('error', '「立即下载」一直不可用（可能没有选中文件）：' + (pageToastText() || ''));

    // 只下载视频：取消勾选非视频文件；视频体积占默认勾选总大小不足阈值则不下载
    const filt = await applyVideoFilter(box);
    mark('filter');
    if (filt.error) {
      closeDialogOf(box);
      return finish('error', filt.error);
    }
    if (filt.skip) {
      closeDialogOf(box);
      return finish('skipped', filt.skip, { stats: filt.stats });
    }

    say('点击「立即下载」');
    startBtn.click();
    // 成功提示或窗口关闭，任一出现就立刻结束（之前只看窗口关闭，窗口不消失时白等 12 秒）
    const closed = await waitFor(function () {
      if (SUCCESS_RE.test(pageToastText())) return 'toast';
      if (!startBtn.isConnected || startBtn.getClientRects().length === 0) return 'closed';
      return null;
    }, 12000);
    mark('click');
    if (!closed && !SUCCESS_RE.test(pageToastText())) {
      return finish('error', pageToastText() || '点击「立即下载」后窗口未关闭，可能需要验证码', { needVerify: true });
    }
    mark('done');
    return finish('ok', '已提交到 NAS 迅雷', { filter: filt.stats });
  }

  function openDialogs() {
    return [...document.querySelectorAll('.el-overlay')].filter(function (o) {
      return o.querySelector('.el-dialog') && getComputedStyle(o).display !== 'none';
    });
  }

  // 复用引擎标签页时，上一个任务可能留下没关的弹窗，先关掉
  async function closeStrayDialogs() {
    const list = openDialogs();
    if (!list.length) return;
    list.forEach(function (o) {
      const b = o.querySelector('.el-dialog__headerbtn');
      if (b) b.click();
    });
    await waitFor(function () { return openDialogs().length === 0; }, 1500);
  }

  function takeJob(onlyMode) {
    const raw = GM_getValue(JOB_KEY, '');
    if (!raw) return null;
    let job = null;
    try { job = JSON.parse(raw); } catch (e) { GM_deleteValue(JOB_KEY); return null; }
    if (!job || !job.magnet || Date.now() - job.ts > JOB_TTL_MS) {
      GM_deleteValue(JOB_KEY);
      return null;
    }
    if (job.v !== VERSION) return null; // 版本不一致的任务不领取，避免用旧规则下载
    if (onlyMode && job.mode !== onlyMode) return null;
    GM_deleteValue(JOB_KEY);
    return job;
  }

  // 工作标签页空闲 IDLE_CLOSE_MS 后自动关闭；每次活动都刷新「最近活动」时间，供 btsow 页判断能否复用
  function resetIdleTimer() {
    GM_setValue(WORKER_KEY, String(Date.now()));
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function () {
      if (engineBusy) return resetIdleTimer();
      GM_deleteValue(WORKER_KEY);
      try { sessionStorage.removeItem(WORKER_FLAG); } catch (e) { /* ignore */ }
      window.close();
    }, IDLE_CLOSE_MS);
  }

  // 处理一个任务；返回 'reload' 表示页面即将重新加载（任务失败后清理现场）
  async function handleJob(job, reused) {
    engineBusy = true;
    job.pickedAt = Date.now();
    try {
      GM_setValue(ACK_KEY, JSON.stringify({ id: job.id, ts: job.pickedAt, reused: !!reused }));
    } catch (e) { /* ignore */ }

    const silent = job.mode === 'silent';
    const marks = {};
    const mark = function (name) { marks[name] = Date.now() - job.pickedAt; };
    let failed = false;
    const say = function (text) {
      if (silent) console.log('[BTSOW engine]', text);
      else notifyEngine(text);
    };
    const finish = function (status, message, extra) {
      if (status === 'error') failed = true;
      const doneAt = Date.now();
      GM_setValue(RESULT_KEY, JSON.stringify(Object.assign({
        id: job.id,
        status: status,
        message: message || '',
        ts: doneAt,
        pickedAt: job.pickedAt,
        reused: !!reused,
        marks: marks,
        engineMs: doneAt - job.pickedAt
      }, extra || {})));
      say((status === 'error' ? '失败：' : '') + (message || status));
    };

    try {
      await engineFlow(job, say, finish, mark, !!reused);
    } catch (e) {
      finish('error', '脚本异常：' + (e && e.message ? e.message : e));
    }

    if (engineWorker) resetIdleTimer();
    if (failed && engineWorker) {
      // 失败后刷新页面，保证下个任务从干净状态开始（工作标签标记保存在 sessionStorage，刷新后仍是工作标签）
      window.setTimeout(function () { location.reload(); }, 300);
      return 'reload';
    }
    engineBusy = false;
    return 'done';
  }

  async function drainJobs(job, reused) {
    let next = job;
    let isReused = reused;
    while (next) {
      const state = await handleJob(next, isReused);
      if (state === 'reload') return;
      isReused = true;
      next = engineWorker ? takeJob('silent') : null;
    }
  }

  async function runEngine() {
    try { engineWorker = sessionStorage.getItem(WORKER_FLAG) === '1'; } catch (e) { engineWorker = false; }
    // 工作标签页只领取后台任务；全新打开的页面可领取任何任务（含 Ctrl+点击的前台任务）
    const first = takeJob(engineWorker ? 'silent' : null);
    if (first && first.mode === 'silent') {
      engineWorker = true;
      try { sessionStorage.setItem(WORKER_FLAG, '1'); } catch (e) { /* ignore */ }
    }
    if (engineWorker) {
      resetIdleTimer();
      GM_addValueChangeListener(JOB_KEY, function (name, oldValue, newValue) {
        if (!newValue || engineBusy) return;
        const job = takeJob('silent');
        if (job) drainJobs(job, true);
      });
    }
    if (first) await drainJobs(first, false);
  }

  // ---------- 可复用按钮类 ----------

  const LIB_CSS = `
.nasxl-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--nasxl-color, #1c1b19);
  border-radius: 0;
  color: var(--nasxl-color, #1c1b19);
  cursor: pointer;
  font: 400 11px/1 "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  letter-spacing: 0.14em;
  margin: 8px 0 0 8px;
  min-height: 36px;
  padding: 0 16px;
  text-transform: uppercase;
  vertical-align: middle;
}
.nasxl-btn:hover:not(:disabled) {
  background: var(--nasxl-color, #1c1b19);
  color: #f3f2ee;
}
.nasxl-btn[data-state="ok"],
.nasxl-btn[data-state="ok"]:hover:not(:disabled) {
  background: #2f7d4f;
  border-color: #2f7d4f;
  color: #ffffff;
  text-transform: none;
}
.nasxl-btn[data-state="loading"] {
  background: #d9d8d3;
  border-color: #b9b8b2;
  color: #77766f;
  cursor: wait;
  text-transform: none;
}
.nasxl-btn[data-state="loading"]::before {
  animation: nasxl-spin 0.8s linear infinite;
  border: 2px solid #b9b8b2;
  border-top-color: #1c1b19;
  border-radius: 50%;
  content: "";
  display: inline-block;
  height: 10px;
  margin-right: 8px;
  vertical-align: -1px;
  width: 10px;
}
@keyframes nasxl-spin {
  to { transform: rotate(360deg); }
}
.nasxl-toast {
  background: #1c1b19;
  color: #f3f2ee;
  font: 400 13px/1.6 "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  left: 50%;
  letter-spacing: 0.04em;
  max-width: 80vw;
  padding: 10px 18px;
  position: fixed;
  top: 72px;
  white-space: pre-line;
  transform: translateX(-50%);
  transition: opacity 0.3s;
  z-index: 2147483000;
}
.nasxl-toast.is-ok { background: #2f7d4f; }
.nasxl-toast.is-error { background: #9b3a2f; }
.nasxl-toast.is-warn { background: #9a6b1f; }
.nasxl-toast.is-out { opacity: 0; }
.nasxl-dialog {
  align-items: center;
  background: rgba(28, 27, 25, 0.35);
  display: flex;
  inset: 0;
  justify-content: center;
  position: fixed;
  z-index: 2147483001;
}
.nasxl-dialog__box {
  background: #f3f2ee;
  border: 1px solid #1c1b19;
  color: #1c1b19;
  font: 400 13px/1.6 "Avenir Next", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  max-width: 92vw;
  padding: 20px 22px;
  width: 360px;
}
.nasxl-dialog__title { font-size: 12px; letter-spacing: 0.14em; margin-bottom: 12px; }
.nasxl-dialog__label {
  color: #77766f;
  display: block;
  font-size: 11px;
  letter-spacing: 0.1em;
  margin: 10px 0 4px;
}
.nasxl-dialog__row { display: flex; gap: 8px; }
.nasxl-dialog__input {
  background: transparent;
  border: 1px solid #1c1b19;
  border-radius: 0;
  box-sizing: border-box;
  color: #1c1b19;
  flex: 1;
  font: inherit;
  padding: 7px 9px;
  width: 100%;
}
.nasxl-dialog__hint {
  color: #77766f;
  font-size: 11px;
  min-height: 4px;
  white-space: pre-line;
}
.nasxl-dialog__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
.nasxl-dialog__btn {
  background: transparent;
  border: 1px solid #1c1b19;
  border-radius: 0;
  color: #1c1b19;
  cursor: pointer;
  font: inherit;
  padding: 6px 14px;
}
.nasxl-dialog__btn.is-primary,
.nasxl-dialog__btn:hover:not(:disabled) {
  background: #1c1b19;
  color: #f3f2ee;
}
.nasxl-dialog__btn:disabled { cursor: wait; opacity: 0.5; }
`;

  const SIZE_PRESETS = {
    small: { minHeight: '28px', fontSize: '10px', padding: '0 10px' },
    medium: { minHeight: '36px', fontSize: '11px', padding: '0 16px' },
    large: { minHeight: '44px', fontSize: '13px', padding: '0 22px' }
  };

  function injectLibStyle() {
    if (document.getElementById('nasxl-style')) return;
    const style = document.createElement('style');
    style.id = 'nasxl-style';
    style.textContent = LIB_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function resolveAnchor(position) {
    if (!position || !position.target) return null;
    return typeof position.target === 'string' ? document.querySelector(position.target) : position.target;
  }

  class NasXunleiButton {
    constructor(options) {
      const o = options || {};
      this.name = o.name || BTN_TEXT;
      this.color = o.color || '#1c1b19';
      this.size = o.size || 'medium';
      this.position = o.position || null;
      this.downloadLink = o.downloadLink || null;
      this.el = null;
    }

    static isEnginePage() {
      return ENGINE_PATH_RE.test(location.pathname);
    }

    getLink() {
      const v = typeof this.downloadLink === 'function' ? this.downloadLink() : this.downloadLink;
      return String(v || '').trim();
    }

    applyStyle() {
      if (!this.el) return;
      this.el.style.setProperty('--nasxl-color', this.color);
      const preset = typeof this.size === 'string' ? (SIZE_PRESETS[this.size] || SIZE_PRESETS.medium) : this.size;
      Object.keys(preset).forEach(function (k) { this.el.style[k] = preset[k]; }, this);
    }

    mount() {
      if (this.el && this.el.isConnected) return this.el;
      const anchor = resolveAnchor(this.position);
      if (!anchor) return null;
      injectLibStyle();

      const self = this;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nasxl-btn';
      btn.textContent = this.name;
      btn._nasxlName = this.name;
      btn.title = '点击：后台静默下载到 NAS；Ctrl+点击：打开 NAS 迅雷网页；右键/长按：设置';
      this.el = btn;
      this.applyStyle();

      let pressTimer = null;
      let longPressed = false;
      const startPress = function () {
        longPressed = false;
        window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(function () {
          longPressed = true;
          openSettings();
        }, 650);
      };
      const endPress = function () { window.clearTimeout(pressTimer); };

      btn.addEventListener('mousedown', function (e) { if (e.button === 0) startPress(); });
      btn.addEventListener('mouseup', endPress);
      btn.addEventListener('mouseleave', endPress);
      btn.addEventListener('touchstart', startPress, { passive: true });
      btn.addEventListener('touchend', endPress);
      btn.addEventListener('touchmove', endPress);
      btn.addEventListener('touchcancel', endPress);
      btn.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        openSettings();
      });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (longPressed) {
          longPressed = false;
          return;
        }
        onNasClick(btn, e, self.getLink());
      });

      anchor.insertAdjacentElement(this.position.where || 'afterend', btn);
      return btn;
    }

    destroy() {
      if (this.el) this.el.remove();
      this.el = null;
    }

    setName(name) {
      this.name = name;
      if (this.el) {
        this.el.textContent = name;
        this.el._nasxlName = name;
      }
    }

    setColor(color) {
      this.color = color;
      this.applyStyle();
    }

    setSize(size) {
      this.size = size;
      this.applyStyle();
    }

    setDownloadLink(link) {
      this.downloadLink = link;
    }
  }


  window.NasXunleiButton = NasXunleiButton;

  // 引擎页：宿主脚本在引擎页加载本库时，自动领取并执行后台任务
  if (ENGINE_PATH_RE.test(location.pathname)) {
    runEngine();
  }
})();
