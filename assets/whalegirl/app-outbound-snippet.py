        # [WHALE-DSH-OUTBOUND] 给 dsh-fish-soul 的微信通道开本地发送口：127.0.0.1:8899/outbound。
        # 丢了这段，dsh 想得出话也发不出去（鲸鱼只有手，出口在这）。端口占用只记日志，不影响桥接本体。
        try:
            import outbound_api as _outbound_api
            _outbound_api.bind(self)
            _outbound_api.start()
        except Exception as exc:
            G.log('本地出站接口未启动 type=%s' % type(exc).__name__)
