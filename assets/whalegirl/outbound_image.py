# -*- coding: utf-8 -*-
"""8899 出站接口的图片 / 表情发送实现。

WHALE-OUTBOUND-IMAGE：本文件由 dsh-fish-soul-patch 的 W6 维护；鲸鱼 App 更新会
整份删掉它，跑一次 `node patch-whalegirl.mjs` 即可复原。

链路：outbound_api 把 base64 图落到 data/dsh-inbox/，这里复用表情包那条
「精确会话核验 + 前台一次粘贴」通道（sticker_transport.guarded_send）发出去。
微信只把 GIF 当动图，其他格式按静态图发。
"""
import os
import time

import engine as G

IMAGE_DIR = os.path.join(G.ROOT, 'data', 'dsh-inbox')


def attach(runtime):
    """把 send_outbound_image 挂到 BridgeRuntime 上；幂等，重复调用不覆盖。"""
    if runtime is None or hasattr(runtime, 'send_outbound_image'):
        return runtime
    runtime.send_outbound_image = lambda path, chat, target='': _send(runtime, path, chat, target)
    return runtime


def _send(self, path, chat_display_name, chat_username=''):
    def bad(reason):
        return {'status': 'failed', 'error': reason}

    path = str(path or '')
    if path == '' or not os.path.isfile(path):
        return bad('no-file')
    if not self.group_is_alive(chat_username) or not self.account_send_allowed('图片出站'):
        return bad('account-or-chat-unavailable')
    if not self.sticker_quarantine_allows(chat_username, chat_display_name):
        return bad('uncertain-draft-must-be-cleared')
    hwnd = int(self.ACCOUNT.get('hwnd') or 0)
    if not hwnd:
        return bad('no-wechat-window')

    snap = None
    try:
        desktop = G.WindowsDesktop()
    except Exception:
        return bad('desktop-unavailable')

    try:
        # ① 需要微信主窗在前台，粘贴通道只往已聚焦的会话发
        try:
            if not desktop.foreground(hwnd):
                snap = self.snapshot_win_state()
                if not self.force_foreground(hwnd) or not desktop.foreground(hwnd):
                    self.restore_win_state(snap)
                    snap = None
                    return bad('could-not-bring-wechat-to-front')
        except Exception:
            if snap is not None:
                try:
                    self.restore_win_state(snap)
                except Exception:
                    pass
                snap = None
            return bad('foreground-safety-unavailable')

        # ② 打开并核验目标会话（群 / 私聊都走 aliases）
        with self.gui_lock:
            if self.gui is None:
                self.gui = self.new_window_driver()
            self.bind_gui_window(self.gui)
            gui = self.gui
            uia = gui._get_uia()
            if uia is None:
                return bad('uia-unavailable')
            aliases = set(self.aliases_for(chat_username, chat_display_name) or [])
            if chat_display_name:
                aliases.add(chat_display_name)
            if chat_username:
                aliases.add(chat_username)
            if not aliases:
                return bad('no-aliases')
            if not G.sticker_alias_match(str(uia.current_chat() or ''), aliases):
                try:
                    opened = uia.open_chat(sorted(aliases))
                except Exception:
                    opened = False
                if not opened:
                    # [WHALE-IMAGE-OPENFALLBACK] 前台 UIA 搜索打开会话失败时，
                    # 改用后台通道（bg_sender）点会话列表切过去——后台这条路
                    # 日志里一直成功，文字发送全靠它；以前这里直接 bad('open-chat-failed')
                    # 把整张图/表情丢掉，现场就是「她要发表情包，结果只发了字」。
                    try:
                        try:
                            from . import bg_sender as _bg
                        except Exception:  # noqa: BLE001 - 单独运行/包外导入时
                            import bg_sender as _bg  # type: ignore
                        _snd = _bg.WeChatSender(hwnd)
                        if _bg.open_chat(_snd, sorted(aliases), log=G.log):
                            G.log('[outbound-image] 前台打开会话失败，已用后台通道切到会话')
                    except Exception as _e:  # noqa: BLE001
                        G.log('[outbound-image] 后台通道切会话失败：%s' % repr(_e))
                for _ in range(8):
                    if G.sticker_alias_match(str(uia.current_chat() or ''), aliases):
                        break
                    time.sleep(0.25)
            if not G.sticker_alias_match(str(uia.current_chat() or ''), aliases):
                return bad('chat-mismatch')

        def gate():
            try:
                return bool(self.send_policy_allows(chat_username, chat_display_name)
                            and self.group_is_alive(chat_username)
                            and int(self.ACCOUNT.get('hwnd') or 0) == hwnd)
            except Exception:
                return False

        def account_valid():
            try:
                return bool(self.ACCOUNT.get('verified')) and self.wechat_window_alive()
            except Exception:
                return False

        with self.send_lock, self.gui_lock:
            outcome = G.guarded_sticker_send(
                gui, uia, hwnd, aliases, path, IMAGE_DIR, self.db, chat_username,
                gate=gate,
                account_valid=account_valid,
                activity_allowed=lambda: self.sticker_activity_allowed(chat_username),
                desktop=desktop,
                confirm_timeout=25.0,      # WHALE-IMAGE-CONFIRM: 微信 4.x 写库延迟 5-10s
            )
    except Exception as exc:
        G.log('[outbound-image] 发送异常 type=%s' % type(exc).__name__)
        return bad('exception:%s' % type(exc).__name__)
    finally:
        if snap is not None:
            try:
                self.restore_win_state(snap)
            except Exception:
                pass

    if not isinstance(outcome, dict):
        return bad('unknown-attachment-result')
    status = str(outcome.get('status') or '')
    if status not in ('confirmed', 'unconfirmed', 'failed', 'cancelled'):
        return bad('unknown-status:%s' % status)
    if status == 'unconfirmed' and outcome.get('draft_may_remain'):
        try:
            self.sticker_draft_quarantine[chat_username] = True
        except Exception:
            pass
    return outcome
