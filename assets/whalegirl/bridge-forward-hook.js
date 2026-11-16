    // [WHALE-DSH-FORWARD-HOOK:BEGIN] 微信入站先交给 dsh-fish-soul 的希希；转过去之后本路由一律不回话
    if (platform === 'wechat') {
      const forward = readForwardConfig();
      if (forward) {
        const mapped = toDshPayload(body);
        if (!mapped) {
          logLine(runtime, 'warn', '[wechat] dsh 转发跳过：入站没有可转的文字正文');
          return json(res, 200, { ok: true, action: 'none', forwarded: false, reason: 'dsh_no_text' });
        }
        try {
          const r = await postJsonTo(forward.url, mapped, forward.timeoutMs, forward.token);
          if (r.status !== 200) {
            logLine(runtime, 'warn', `[wechat] dsh 入站返回 HTTP ${r.status}：${String(r.body || '').slice(0, 120)}`);
            return json(res, 200, { ok: true, action: 'none', forwarded: false, reason: `dsh_http_${r.status}` });
          }
          const ev = mapped.events[0];
          logLine(runtime, 'info', `[wechat] 已转发 dsh：${ev.chatType} ${ev.senderName || ev.senderId} → ${ev.targetId}`);
          return json(res, 200, { ok: true, action: 'none', forwarded: true, reason: 'forwarded_to_fish_soul' });
        } catch (err) {
          // dsh 没在跑也绝不回退给鲸鲸：用户要的是希希，宁可这条不回，也不让鲸鲸插嘴。
          logLine(runtime, 'warn', `[wechat] 转发 dsh 失败：${err && err.message ? err.message : err}`);
          return json(res, 200, { ok: true, action: 'none', forwarded: false, reason: 'dsh_unreachable' });
        }
      }
    }
    // [WHALE-DSH-FORWARD-HOOK:END]
