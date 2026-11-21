  // [WHALE-MOMENTS-EXTERNAL] dsh（fish-soul）把文案写好送过来，鲸鱼只负责点「发表」。
  // body：{ text, emotion, withImage }；成功返回 { ok: true, job }，失败 { ok: false, error }。
  router.post('/api/moments/publish-external', async (runtime, req, res) => {
    local(req);
    const body = await readBody(req) || {};
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const emotion = Object.hasOwn(EMOTIONS, body.emotion) ? body.emotion : 'happy';
    const code = runtime.momentsPublisher.queueExternal(accountReady(runtime), text, emotion, body.withImage === true);
    if (!code) {
      const info = publishInfo(runtime);
      return json(res, 200, { ...info, ok: true, job: runtime.momentsPublisher.job?.id || '' });
    }
    const messages = {
      feature_disabled: '请先开启并保存朋友圈发表总开关',
      account_not_verified: '请先启动桥接并确认微信账号，或检查发表状态文件',
      invalid_text: '文案不合规（需要 8~120 字，且不能含链接、电话、隐私信息）',
      busy: '还有一条朋友圈任务未完成',
    };
    return json(res, code === 'invalid_text' ? 400 : 409, { ok: false, error: messages[code] || code });
  });

