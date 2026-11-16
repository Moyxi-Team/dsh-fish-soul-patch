# -*- coding: utf-8 -*-
"""图片密钥取不到时的「界面兜底」：让微信自己把画好的图交出来。

背景
    微信 4.x 的图片在磁盘上是加密的 ``.dat``（V2：AES + XOR），密钥只能从
    ``Weixin.exe`` 进程内存里反推。取不到密钥时磁盘那条路走不通；但微信界面上
    已经把图画出来了，所以还有两条退路：

    1. **导出**：``MediaDownloader.download_image_original()`` 会点开气泡、等原图
       落盘，等不到就点预览窗的「保存」，由微信自己写出一份明文图片文件；
    2. **截预览窗**：保存对话框走不通时，把预览窗（图片显示区）从屏幕上截下来，
       直接送看图模型——图片里是文字还是照片都能看，不依赖 OCR。

代价（用户已知并接受）
    两条路都要动微信窗口：可能短暂把微信带到前台、移动鼠标点气泡、弹出/关闭预览窗。
    所以只在「磁盘解密失败」之后才走，并且整段有超时；失败只会让这一条不回话，
    不会再把会话卡住（外面上限见 ``receiver_mixin.run_media_with_timeout``）。

只读 vendor：调用它已有的方法，不改源码。
"""

# WHALE-UI-FALLBACK 界面兜底：按控件类名定位图片气泡，并先滚进可视区再点开截图（由补丁仓 assets/whalegirl 维护）

from __future__ import annotations

import io
import os
import time

# 导出 + 截图两段各自的预算；外面还有 180 秒的识别总上限兜底。
EXPORT_TIMEOUT = 20.0
CAPTURE_TIMEOUT = 15.0
# 默认不做时间窗丢弃：聊天不会等，每张图都要给一次机会。
# 这个参数只留给「明确想限制界面操作频率」的调用方（测试也在用）。
FAIL_COOLDOWN = 0.0

_state = {'blocked_until': 0.0}


def reset_cooldown():
    """测试用：清掉冷却状态。"""
    _state['blocked_until'] = 0.0


def _say(log, *args):
    if log:
        try:
            log(*args)
        except Exception:
            pass


def export_original(dl, msg, chat_name='', save_dir=None, log=None, timeout=EXPORT_TIMEOUT):
    """让微信自己导出一份明文图片，返回文件路径；失败返回空串。"""
    method = getattr(dl, 'download_image_original', None)
    if not callable(method):
        _say(log, '界面兜底：当前媒体下载器不支持导出原图')
        return ''
    try:
        username = msg.get('username') or ''
        local_id = msg.get('local_id')
        if not username or local_id is None:
            _say(log, '界面兜底：消息缺会话或消息 id，无法导出')
            return ''
        _say(log, '界面兜底：开始让微信导出图片（消息id=%s:%s）'
             % (msg.get('shard') or '', local_id))
        path = method(username, int(local_id), save_dir=save_dir,
                      chat_name=(chat_name or None), shard=msg.get('shard'),
                      timeout=float(timeout))
        if path:
            try:
                size_kb = os.path.getsize(path) // 1024
            except OSError:
                size_kb = 0
            _say(log, '界面兜底：已让微信导出图片（%d KB）' % size_kb)
            return path
        _say(log, '界面兜底：微信没导出图片（气泡不在可视区 / 预览窗没弹 / 保存对话框没走通）')
    except Exception as exc:  # noqa: BLE001 - 兜底失败只影响这一条
        _say(log, '界面兜底导出异常：', type(exc).__name__, str(exc)[:120])
    return ''


def _rect(ctrl):
    """控件矩形（整数，宽高都至少 120 才认）。"""
    try:
        r = ctrl.BoundingRectangle
        left, top = int(r.left), int(r.top)
        right, bottom = int(r.right), int(r.bottom)
    except Exception:
        return None
    if right - left < 120 or bottom - top < 120:
        return None
    return (left, top, right, bottom)


# 微信 4.x 把每张图片渲染成「ListItemControl + mmui::ChatImageItemView」，实测可靠。
IMAGE_ROW_CLASS = 'ChatImageItemView'
# 把图片气泡滚进可视区时最多滚几次（一格约 55px，图行约 400px 高，6 次已足够）
MAX_SCROLL_STEPS = 12


class _SimpleRect(object):
    __slots__ = ('left', 'top', 'right', 'bottom')

    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom


class _RectBox(object):
    """把矩形元组包成带 ``BoundingRectangle`` 的轻量对象，复用 vendor 的点击点计算。"""

    __slots__ = ('BoundingRectangle',)

    def __init__(self, rect):
        left, top, right, bottom = rect
        self.BoundingRectangle = _SimpleRect(left, top, right, bottom)


def _norm_rect(obj):
    """控件或矩形元组 -> ``(left, top, right, bottom)``；取不到返回 None。"""
    if isinstance(obj, tuple):
        return obj
    try:
        r = obj.BoundingRectangle
        return (int(r.left), int(r.top), int(r.right), int(r.bottom))
    except Exception:
        return None


def _image_rows(lst):
    """消息列表里当前物化出来的图片气泡行，按 top 升序（最后一个是最近的）。"""
    rows = []
    try:
        kids = lst.GetChildren() or []
    except Exception:
        return rows
    for k in kids:
        try:
            if IMAGE_ROW_CLASS in (k.ClassName or ''):
                rect = _norm_rect(k)
                if rect and rect[2] - rect[0] > 100 and rect[3] - rect[1] > 100:
                    rows.append((k, rect))
        except Exception:
            continue
    rows.sort(key=lambda item: item[1][1])
    return rows


def locate_latest_image_row(uia, lst, log=None, max_steps=MAX_SCROLL_STEPS, sleep=None):
    """按控件类名找会话里最新的一张图片气泡，并把它滚进可视区。

    不依赖数据库顺序对齐：微信 4.x 把每张图渲染成 ``mmui::ChatImageItemView`` 行，
    「最新」就是 top 最大的那一行。这一步专门解决「图片被后来的消息顶出可视区、
    点不到气泡」——用滚轮把行带回列表可视区再点，全程不碰加密容器。

    返回 ``(控件, 矩形)``；找不到返回 ``None``。
    """
    pause = sleep or time.sleep
    list_rect = _norm_rect(lst)
    if not list_rect:
        _say(log, '界面兜底：读不到消息列表矩形，无法滚动定位')
        return None
    vtop, vbottom = list_rect[1] + 8, list_rect[3] - 8
    cx = int((list_rect[0] + list_rect[2]) / 2)
    cy = int((vtop + vbottom) / 2)
    steps = max(1, int(max_steps))
    for step in range(steps + 1):
        rows = _image_rows(lst)
        if not rows:
            _say(log, '界面兜底：消息列表里没有图片气泡控件')
            return None
        ctrl, rect = rows[-1]
        if rect[1] >= vtop and rect[3] <= vbottom:
            if step:
                _say(log, '界面兜底：滚动 %d 次后图片气泡进入可视区' % step)
            return ctrl, rect
        if step >= steps:
            break
        delta = 120 if rect[1] < vtop else -120      # 在上方就向上滚，反之向下滚
        try:
            uia._wheel_at(cx, cy, delta)
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：滚动消息列表失败（%s）' % type(exc).__name__)
            return None
        pause(0.45)
    _say(log, '界面兜底：滚动 %d 次仍没把图片气泡带进可视区' % steps)
    return None


def capture_preview_image(dl, msg, chat_name='', log=None, timeout=CAPTURE_TIMEOUT,
                          uia=None, inp=None, grab=None, sleep=None):
    """点开这条图片的预览窗并截下图片区域，返回图片字节；失败返回 b''。

    参数里的 ``uia`` / ``inp`` / ``grab`` / ``sleep`` 只为测试注入，生产留空即可。
    """
    username = msg.get('username') or ''
    local_id = msg.get('local_id')
    if not username or local_id is None:
        _say(log, '界面兜底：消息缺会话或消息 id，无法定位图片')
        return b''
    pause = sleep or time.sleep
    try:
        if uia is None or inp is None:
            from wechatauto.uia_driver import WeChatUIA
            from wechatauto.guia import WinInput
            uia = uia or WeChatUIA()
            inp = inp or WinInput()
        if grab is None:
            from PIL import ImageGrab
            grab = ImageGrab.grab
    except Exception as exc:  # noqa: BLE001
        _say(log, '界面兜底不可用（UIA/截图库缺失）：', repr(exc))
        return b''

    import ctypes
    VK_ESCAPE = 0x1B
    _say(log, '界面兜底：开始截预览窗（消息id=%s:%s）'
         % (msg.get('shard') or '', local_id))

    try:
        if not uia.ensure_window():
            _say(log, '界面兜底：拿不到微信主窗（没登录 / 控件树没物化）')
            return b''
        want = (chat_name or '').strip()
        try:
            if want and (uia.current_chat() or '').strip() != want:
                from wechatauto.wx import WeChat
                WeChat().ChatWith(want)
                pause(1.5)
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：切到目标会话失败（%s），按当前会话继续试'
                 % type(exc).__name__)
        lst = uia._message_list()
        if lst is None:
            _say(log, '界面兜底：消息列表不在控件树里（微信停在其它页？）')
            return b''
        hwnd = pid = None
        try:
            handles = uia._wechat_hwnds()
            if handles:
                hwnd = handles[0]
                pid = uia._pid_from_hwnd(hwnd)
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：取微信窗口句柄失败（%s），不滚动界面' % type(exc).__name__)
        deadline = time.monotonic() + max(3.0, float(timeout))
        row = None
        db_seq = []
        try:
            row = dl.db.get_message_row(username, int(local_id), local_type=3,
                                        shard=msg.get('shard'))
            recent = dl.db.get_messages(username, limit=400)      # 降序
            db_seq = [{'kind': dl._DB_ROW_KIND.get(r.get('type') or ''),
                       'content': r.get('content') or '',
                       'local_id': r.get('local_id')} for r in reversed(recent)]
            db_seq = [d for d in db_seq if d['kind']]
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：读消息历史失败（%s），降级按图片顺序找' % type(exc).__name__)
            row = row or None
        target = None
        target_rect = None
        if db_seq:
            try:
                target, _note = dl._locate_image_row(
                    int(local_id), lst, db_seq, uia, hwnd, pid,
                    min(deadline, time.monotonic() + 4.0),
                    max_scrolls=3 if pid else 0)
            except Exception as exc:  # noqa: BLE001
                _say(log, '界面兜底：定位图片行异常（%s）' % type(exc).__name__)
                target = None
        if target is not None:
            target_rect = _norm_rect(target)
        if target is None or not target_rect:
            # 数据库顺序对不上时，退回「按控件类名找最新图片气泡 + 滚动到可视区」：
            # 这条路完全不碰解密，只认微信自己已经画在界面上的那张图。
            _say(log, '界面兜底：数据库顺序没对上，改用控件定位最新图片气泡')
            found = locate_latest_image_row(uia, lst, log=log, sleep=pause)
            if found is None:
                _say(log, '界面兜底：没在可视区认出这条图片气泡，跳过截图')
                return b''
            target, target_rect = found
            # 滚动本身要花几秒，别让点击环节的预算被它吃光
            deadline = max(deadline, time.monotonic() + 6.0)
        is_self = False
        try:
            is_self = bool(row and dl._sent_by_self(row))
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：判断发送方失败（%s），按对方发送处理' % type(exc).__name__)
            is_self = False
        before = set()
        try:
            before = {h for h, _w in dl._preview_windows()}
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：读取已有预览窗失败（%s），按没有处理' % type(exc).__name__)
            before = set()
        rect_obj = _RectBox(target_rect)
        cy = int((target_rect[1] + target_rect[3]) / 2)
        xs = []
        try:
            xs = list(dl._bubble_click_xs(rect_obj, is_self) or [])
        except Exception as exc:  # noqa: BLE001
            _say(log, '界面兜底：算点击点失败（%s），用默认点位' % type(exc).__name__)
        if not xs:
            xs = [target_rect[0] + 130, int((target_rect[0] + target_rect[2]) / 2),
                  target_rect[2] - 130]
        for cx in xs:
            if time.monotonic() >= deadline:
                break
            try:
                inp.real_click(int(cx), cy)
            except Exception as exc:  # noqa: BLE001
                _say(log, '界面兜底：点击图片气泡失败（%s）' % type(exc).__name__)
                return b''
            while time.monotonic() < deadline:
                try:
                    fresh = [(h, w) for h, w in dl._preview_windows() if h not in before]
                except Exception as exc:  # noqa: BLE001
                    _say(log, '界面兜底：检测预览窗失败（%s）' % type(exc).__name__)
                    fresh = []
                if fresh:
                    bbox = _rect(fresh[0][1])
                    if bbox is None:
                        try:
                            import uiautomation as auto
                            bbox = _rect(auto.ControlFromHandle(fresh[0][0]))
                        except Exception as exc:  # noqa: BLE001
                            _say(log, '界面兜底：预览窗矩形取不到（%s）' % type(exc).__name__)
                            bbox = None
                        if bbox is None:
                            _say(log, '界面兜底：预览窗太小或没有有效矩形，放弃截图')
                    data = b''
                    if bbox:
                        try:
                            image = grab(bbox=bbox)
                            buf = io.BytesIO()
                            image.convert('RGB').save(buf, format='JPEG', quality=88)
                            data = buf.getvalue()
                        except Exception as exc:  # noqa: BLE001
                            _say(log, '界面兜底截图失败：%s' % type(exc).__name__)
                    # 不管截没截到都要把预览窗关掉，别把用户界面留在别人脸上
                    try:
                        if hasattr(inp, 'key'):
                            inp.key(VK_ESCAPE)
                        else:                                    # pragma: no cover - 老版本兜底
                            ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, 0, 0)
                            ctypes.windll.user32.keybd_event(VK_ESCAPE, 0, 2, 0)
                    except Exception as exc:  # noqa: BLE001
                        _say(log, '界面兜底：关闭预览窗失败（%s）' % type(exc).__name__)
                    if data:
                        _say(log, '界面兜底：已截下这条图片预览（%d KB）' % (len(data) // 1024))
                        return data
                    return b''
                pause(0.3)
        return b''
    except Exception as exc:  # noqa: BLE001
        _say(log, '界面兜底截图异常：', type(exc).__name__, str(exc)[:120])
        return b''


def _preview_handles(dl, log=None):
    try:
        return {h for h, _w in dl._preview_windows()}
    except Exception as exc:  # noqa: BLE001
        _say(log, '界面兜底：读取预览窗列表失败（%s）' % type(exc).__name__)
        return set()


def close_new_previews(dl, before, log=None):
    """把兜底过程中新开的预览窗关掉（用户本来就开着的那些不动）。"""
    try:
        fresh = [h for h, _w in dl._preview_windows() if h not in before]
    except Exception as exc:  # noqa: BLE001
        _say(log, '界面兜底：关闭前读取预览窗失败（%s）' % type(exc).__name__)
        return 0
    if not fresh:
        return 0
    try:
        from wechatauto.guia import WinInput
        keys = WinInput()
        for _h in fresh:
            keys.key(0x1B)                 # Esc：关掉当前预览窗
            time.sleep(0.2)
    except Exception as exc:  # noqa: BLE001
        _say(log, '界面兜底：关闭预览窗失败（%s）' % type(exc).__name__)
        return 0
    _say(log, '界面兜底：已关掉 %d 个预览窗' % len(fresh))
    return len(fresh)


def read_image_via_ui(dl, msg, chat_name='', save_dir=None, log=None,
                      export_timeout=EXPORT_TIMEOUT, capture_timeout=CAPTURE_TIMEOUT,
                      cooldown=FAIL_COOLDOWN, **kwargs):
    """先让微信导出明文，导不出再截预览窗。返回图片字节；都失败返回 b''。

    默认不在失败后关门：聊天不会等，下一张图照样要试一次（每次都有
    ``export_timeout`` + ``capture_timeout`` 的上限，外面还有识别总超时）。
    ``cooldown`` 只在调用方明确要限制界面操作频率时才大于 0。
    """
    if time.monotonic() < _state['blocked_until']:
        _say(log, '界面兜底按调用方的冷却设置跳过这张')
        return b''
    before = _preview_handles(dl, log=log)
    path = export_original(dl, msg, chat_name=chat_name, save_dir=save_dir,
                           log=log, timeout=export_timeout)
    data = b''
    if path:
        try:
            with open(path, 'rb') as stream:
                data = stream.read()
        except OSError as exc:
            _say(log, '界面兜底：导出的文件读不了：', repr(exc))
            data = b''
    if not data:
        data = capture_preview_image(dl, msg, chat_name=chat_name, log=log,
                                     timeout=capture_timeout, **kwargs)
    try:
        close_new_previews(dl, before, log=log)
    except Exception:
        pass
    if data:
        _state['blocked_until'] = 0.0
    elif cooldown and float(cooldown) > 0:
        _state['blocked_until'] = time.monotonic() + float(cooldown)
        _say(log, '界面兜底没取到图，按调用方设置冷却 %.0f 秒' % cooldown)
    else:
        _say(log, '界面兜底没取到图；下一张图仍会再试一次')
    return data
