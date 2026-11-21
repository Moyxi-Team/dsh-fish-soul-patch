
  // [WHALE-MOMENTS-EXTERNAL] dsh（fish-soul）自己写好文案，鲸鱼只当「手」去发表：
  // 跳过鲸鱼这边的模型生成，直接把外部文案压进队列。manual 表示不占鲸鱼自己的每日额度，
  // 发表仍然走同一条 claim / complete 通道，桥接那侧不用改。
  queueExternal(account, text, emotion, withImage) {
    this.expire();
    this.reconcile();
    const settings = this.settings();
    if (!settings.featureEnabled) return 'feature_disabled';
    if (!account || this.stateError) return 'account_not_verified';
    // 复用鲸鱼自己的文案校验（8~120 字、不含链接 / 电话 / 隐私），外部文案一样要过。
    const draft = parseDraft(JSON.stringify({ text, emotion }), []);
    if (!draft) return 'invalid_text';
    if (this.job || this.generating) return 'busy';
    this.queueDraft(draft, account, settings, { manual: true, external: true }, withImage === true);
    return '';
  }

