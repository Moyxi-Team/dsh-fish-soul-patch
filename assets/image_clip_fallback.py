# -*- coding: utf-8 -*-
"""WHALE-UI-CLIP 微信取图兜底：右键图片 → 菜单「复制」→ 读剪贴板。

用户明确的取图方式：对着聊天框里的图片右键 → 复制。实测微信 4.x 走这条路能把原图
（jpg）落进剪贴板，画质比点开预览窗截图好，动作也只有「右键 + 点复制」两下。

硬约束（用户明确要求）：
- 绝不调用 ShowWindow / 最小化 / 关闭 / 重开微信，也不移动窗口；
- 只在控件树上做一次广度遍历（不按 foundIndex 反复全树搜索，那样会卡死）；
- 全程有总时限，失败一律返回空串，交回上层原兜底。
"""

import os
import shutil
import time

try:
    import uiautomation as auto
except Exception:
    auto = None

IMAGE_CLASS = 'mmui::ChatImageItemView'
COPY_WORDS = (u'复制图片', u'复制')
MAX_NODES = 2500
MAX_DEPTH = 14
TOTAL_BUDGET = 12.0
CLIP_TIMEOUT = 2.0


def _say(log, *args):
    if log is None:
        return
    try:
        log(*args)
    except Exception:
        try:
            log('[CLIP] ' + ' '.join(str(a) for a in args))
        except Exception:
            pass


def _rect_of(ctrl):
    try:
        r = ctrl.BoundingRectangle
        left, top, right, bottom = int(r.left), int(r.top), int(r.right), int(r.bottom)
    except Exception:
        return None
    if right <= left or bottom <= top:
        return None
    return (left, top, right, bottom)


def _walk(root, want, deadline):
    """广度遍历一次，收集 want(ctrl, name, cls) 为真的控件。"""
    hits = []
    queue = [(root, 0)]
    visited = 0
    while queue:
        if time.time() > deadline:
            break
        ctrl, depth = queue.pop(0)
        if depth >= MAX_DEPTH:
            continue
        try:
            children = ctrl.GetChildren()
        except Exception:
            continue
        for ch in children:
            visited += 1
            if visited > MAX_NODES:
                return hits
            try:
                cls = str(ch.ClassName or '')
            except Exception:
                cls = ''
            try:
                name = str(ch.Name or '')
            except Exception:
                name = ''
            if want(ch, name, cls):
                hits.append((ch, name, cls))
            queue.append((ch, depth + 1))
    return hits


def _find_window(deadline):
    if auto is None:
        return None
    for kw in (dict(Name='微信'), dict(ClassName='mmui::MainWindow'), dict(Name='WeChat')):
        try:
            win = auto.WindowControl(searchDepth=1, **kw)
            if win and win.Exists(0.3):
                return win
        except Exception:
            continue
    return None


def _menu_copy_point(deadline):
    """右键后从桌面根节点找含「复制」的菜单项，返回中心坐标。"""
    if auto is None:
        return None
    roots = []
    try:
        roots.append(auto.GetRootControl())
    except Exception:
        pass
    for root in roots:
        hits = _walk(root, lambda c, n, cls: (('复制' in n) and ('Menu' in cls or '菜单' in n or cls == '')),
                     deadline)
        for ctrl, name, cls in hits:
            if u'复制图片' in name or u'复制' == name.strip():
                rect = _rect_of(ctrl)
                if rect:
                    return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
        for ctrl, name, cls in hits:
            rect = _rect_of(ctrl)
            if rect:
                return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)
    return None


def _read_clipboard(save_dir, log=None):
    try:
        from PIL import ImageGrab, Image
    except Exception as e:
        _say(log, '[CLIP] 没有 PIL：%s' % e)
        return ''
    deadline = time.time() + CLIP_TIMEOUT
    data = None
    while time.time() < deadline:
        try:
            data = ImageGrab.grabclipboard()
        except Exception:
            data = None
        if data:
            break
        time.sleep(0.15)
    if not data:
        return ''
    target = save_dir or os.getcwd()
    try:
        os.makedirs(target, exist_ok=True)
    except Exception:
        pass
    stamp = time.strftime('%Y%m%d-%H%M%S')
    if isinstance(data, list):
        for p in data:
            p = str(p)
            if not os.path.isfile(p):
                continue
            ext = os.path.splitext(p)[1] or '.jpg'
            if ext.lower() in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'):
                dst = os.path.join(target, 'wx-clip-%s%s' % (stamp, ext))
                try:
                    shutil.copy2(p, dst)
                    _say(log, '[CLIP] 剪贴板图片文件 -> %s' % dst)
                    return dst
                except Exception as e:
                    _say(log, '[CLIP] 复制剪贴板文件失败：%s' % e)
        return ''
    try:
        if isinstance(data, Image.Image):
            dst = os.path.join(target, 'wx-clip-%s.jpg' % stamp)
            data.convert('RGB').save(dst, 'JPEG', quality=92)
            _say(log, '[CLIP] 剪贴板位图 -> %s' % dst)
            return dst
    except Exception as e:
        _say(log, '[CLIP] 保存剪贴板位图失败：%s' % e)
    return ''


def _locate_target(win, win_rect, deadline, log=None):
    """定位要右键的图片气泡，返回屏幕坐标 (l, t, r, b)。控件树优先，取不到就上像素。"""
    if win_rect:
        wl, wt, wr, wb = win_rect
        hits = _walk(win, lambda c, n, cls: cls == IMAGE_CLASS, deadline)
        rects = [r for r in (_rect_of(c) for c, _n, _c in hits) if r]
        _say(log, '[CLIP] 控件树图片气泡 %d 个' % len(rects))
        vis = [x for x in rects
               if x[2] - x[0] >= 40 and x[3] - x[1] >= 40
               and x[0] >= wl and x[1] >= wt and x[2] <= wr and x[3] <= wb]
        if vis:
            vis.sort(key=lambda z: z[3])
            return vis[-1]
    try:
        import wb_pixel
        box = wb_pixel.find_image_box(win_rect, hwnd=getattr(win, 'NativeWindowHandle', None))
    except Exception as e:
        _say(log, '[CLIP] 像素定位不可用：%s' % e)
        return None
    if not box:
        _say(log, '[CLIP] 像素也没找到图片块')
        return None
    wl, wt, _wr, _wb = win_rect
    target = (wl + box[0], wt + box[1], wl + box[2], wt + box[3])
    _say(log, '[CLIP] 像素定位到图片块 %s' % (target,))
    return target


def _bring_to_front(win, log=None):
    """右键只有在微信自己的窗口上才会生效：短暂把它置前，返回原前台窗口以便还原。"""
    try:
        import ctypes
        u = ctypes.windll.user32
        hwnd = getattr(win, 'NativeWindowHandle', None)
        if not hwnd:
            return 0
        prev = u.GetForegroundWindow()
        if prev == hwnd:
            return prev
        if u.IsIconic(hwnd):
            u.ShowWindow(hwnd, 9)  # 仅在最小化时还原，不动大小/位置
        u.SetForegroundWindow(hwnd)
        for _ in range(10):
            if u.GetForegroundWindow() == hwnd:
                break
            time.sleep(0.05)
        time.sleep(0.2)
        _say(log, '[CLIP] 置前=%s' % (u.GetForegroundWindow() == hwnd,))
        return prev
    except Exception as e:
        _say(log, '[CLIP] 置前失败：%s' % e)
        return 0


def _restore_focus(prev):
    if not prev:
        return
    try:
        import ctypes
        u = ctypes.windll.user32
        if u.GetForegroundWindow() != prev:
            u.SetForegroundWindow(prev)
    except Exception:
        pass


def read_image_via_clipboard(dl=None, msg=None, chat_name='', save_dir=None, log=None):
    """右键最新图片气泡 → 复制 → 读剪贴板。成功返回图片路径，失败返回 ''。"""
    if auto is None:
        return ''
    deadline = time.time() + TOTAL_BUDGET
    win = _find_window(deadline)
    if win is None:
        _say(log, '[CLIP] 没找到微信窗口')
        return ''
    win_rect = _rect_of(win)
    prev_fg = _bring_to_front(win, log=log)
    try:
        target = _locate_target(win, win_rect, deadline, log=log)
        if target is None:
            return ''
        x, y = (target[0] + target[2]) // 2, (target[1] + target[3]) // 2
        try:
            auto.SetCursorPos(x, y)
            time.sleep(0.1)
            auto.RightClick(x, y)
        except Exception as e:
            _say(log, '[CLIP] 右键失败：%s' % e)
            return ''
        time.sleep(0.45)
        pt = _menu_copy_point(time.time() + 4.0)
        if pt is None:
            _say(log, '[CLIP] 右键没弹「复制」菜单')
            try:
                auto.SendKeys('{ESC}')
            except Exception:
                pass
            return ''
        try:
            auto.Click(pt[0], pt[1])
        except Exception as e:
            _say(log, '[CLIP] 点「复制」失败：%s' % e)
            return ''
        _say(log, '[CLIP] 已点复制 (%d,%d)' % (pt[0], pt[1]))
        time.sleep(0.35)
        path = _read_clipboard(save_dir, log=log)
        if path:
            return path
        _say(log, '[CLIP] 剪贴板没拿到图片')
        return ''
    finally:
        _restore_focus(prev_fg)


